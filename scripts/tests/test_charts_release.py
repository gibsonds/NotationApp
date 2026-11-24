"""Release safety regressions. AWS/GitHub/network calls are mocked, never live."""
import copy, importlib.util, json, os, shutil, subprocess, tempfile, time, unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('release', Path(__file__).parents[1]/'charts_release.py')
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)
SHA = 'a' * 40
FEATURES = {'multiBookInvites': False, 'verifiedEmail': False}


def function(version=None):
    value = {'FunctionArn': r.FUNCTION_ARN, 'Runtime': 'nodejs22.x', 'Handler': 'index.handler',
             'Role': 'execution-role', 'RevisionId': 'revision', 'CodeSha256': 'old-code',
             'Environment': {'Variables': {'COOKIE_SESSIONS': '1', 'APP_ORIGINS': r.ORIGIN}}, 'Version': '$LATEST'}
    if version:
        value.update(FunctionArn=r.FUNCTION_ARN+':'+version, Version=version)
    return value


def policy(source=None):
    return {'Statement': [{'Effect': 'Allow', 'Action': 'lambda:InvokeFunction',
            'Principal': {'Service': 'apigateway.amazonaws.com'}, 'Resource': r.FUNCTION_ARN,
            'Condition': {'ArnLike': {'AWS:SourceArn': source or f'arn:aws:execute-api:{r.REGION}:{r.ACCOUNT}:{r.API}/*/*/*'}}}]}


class ReleaseTests(unittest.TestCase):
    def test_workflow_checks_out_trusted_dispatch_sha_never_untrusted_input(self):
        workflow = (Path(__file__).parents[2]/'.github/workflows/charts-release.yml').read_text()
        self.assertNotIn('ref: ${{ inputs.commit }}', workflow)
        self.assertEqual(workflow.count('ref: ${{ github.sha }}'), 2)
        self.assertEqual(workflow.count('"$RELEASE_SHA" == "$GITHUB_SHA"'), 2)
        for part in workflow.split('steps:')[1:]:
            self.assertLess(part.index('"$RELEASE_SHA" == "$GITHUB_SHA"'), part.index('actions/checkout@'))

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.bundle = Path(self.temp.name)/'bundle'
        (self.bundle/'out/_next/static').mkdir(parents=True)
        (self.bundle/'backend.zip').write_bytes(b'new-code')
        (self.bundle/'out/index.html').write_text('synthetic frontend')
        (self.bundle/'out/_next/static/app.js').write_text('synthetic js')
        (self.bundle/'out/manifest.json').write_text('public nested manifest')
        r.manifest(self.bundle, SHA, FEATURES)
        self.state = Path(self.temp.name)/'state'

    def test_build_guards_fail_before_artifact_or_dependency_execution(self):
        root = Path(self.temp.name)/'repo'
        (root/'scripts').mkdir(parents=True)
        shutil.copy(Path(__file__).parents[1]/'build-charts-release.sh', root/'scripts/build-charts-release.sh')
        def git(*args):
            return subprocess.run(['git', '-c', 'core.hooksPath=/dev/null', *args], cwd=root, check=True, capture_output=True, text=True).stdout.strip()
        git('init', '-q')
        (root/'tracked').write_text('before')
        git('add', '.')
        git('-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.test', 'commit', '-qm', 'synthetic fixture')
        sha = git('rev-parse', 'HEAD')
        invalid = subprocess.run(['bash', 'scripts/build-charts-release.sh', 'invalid'], cwd=root, capture_output=True, text=True)
        self.assertNotEqual(invalid.returncode, 0)
        self.assertIn('Full lowercase source SHA required', invalid.stderr)
        (root/'tracked').write_text('dirty')
        dirty = subprocess.run(['bash', 'scripts/build-charts-release.sh', sha], cwd=root, capture_output=True, text=True)
        self.assertNotEqual(dirty.returncode, 0)
        self.assertIn('Tracked worktree is dirty', dirty.stderr)
        self.assertFalse((root/'release-bundle').exists())

    def live_responses(self):
        return {
            ('sts','get-caller-identity'):{'Account':r.ACCOUNT,'Arn':f'arn:aws:sts::{r.ACCOUNT}:assumed-role/NotationChartsRelease/synthetic'},
            ('lambda','get-function-configuration'):function(),
            ('apigatewayv2','get-api'):{'ProtocolType':'HTTP','ApiEndpoint':f'https://{r.API}.execute-api.{r.REGION}.amazonaws.com'},
            ('apigatewayv2','get-integrations'):{'Items':[{'IntegrationId':r.INTEGRATION,'IntegrationUri':r.FUNCTION_ARN,'IntegrationType':'AWS_PROXY','PayloadFormatVersion':'2.0'}]},
            ('apigatewayv2','get-stages'):{'Items':[{'StageName':'$default','AutoDeploy':True}]},
            ('lambda','get-policy'):{'Policy':json.dumps(policy())},
            ('apigatewayv2','get-routes'):{'Items':[]},
            ('cloudfront','get-distribution-config'):{'DistributionConfig':{'Aliases':{'Items':['charts.collisionstorm.com']},'DefaultCacheBehavior':{'TargetOriginId':'site'},'Origins':{'Items':[{'Id':'site','DomainName':r.BUCKET+'.s3.amazonaws.com'},{'Id':'api','DomainName':f'{r.API}.execute-api.{r.REGION}.amazonaws.com'}]},'CacheBehaviors':{'Items':[{'PathPattern':'/auth-api/*','TargetOriginId':'api'}]}}},
            ('s3api','get-bucket-versioning'):{'Status':'Enabled'},
        }

    def test_live_preflight_rejects_wrong_targets_before_writes(self):
        def run(responses):
            def aws(service, op, *args, **kw):
                self.assertIn((service,op), responses, 'unexpected mutation')
                return copy.deepcopy(responses[(service,op)])
            with patch.object(r,'aws',side_effect=aws):
                return r.inspect_live(FEATURES)
        good=self.live_responses()
        self.assertEqual(run(good)[2],r.ROUTES)
        changes=[
            (('sts','get-caller-identity'),['Account'],'wrong'),
            (('sts','get-caller-identity'),['Arn'],f'arn:aws:sts::{r.ACCOUNT}:assumed-role/Other/synthetic'),
            (('lambda','get-function-configuration'),['FunctionArn'],'wrong'),
            (('lambda','get-function-configuration'),['Runtime'],'nodejs20.x'),
            (('lambda','get-function-configuration'),['Handler'],'other.handler'),
            (('lambda','get-function-configuration'),['Environment','Variables','COOKIE_SESSIONS'],'0'),
            (('lambda','get-function-configuration'),['Environment','Variables','APP_ORIGINS'],'https://other.test'),
            (('lambda','get-function-configuration'),['Environment','Variables','MULTI_BOOK_INVITES'],'1'),
            (('apigatewayv2','get-api'),['ProtocolType'],'WEBSOCKET'),
            (('apigatewayv2','get-integrations'),['Items',0,'IntegrationUri'],'wrong'),
            (('apigatewayv2','get-integrations'),['Items',0,'RequestParameters'],{'overwrite:path':'/other'}),
            (('apigatewayv2','get-stages'),['Items',0,'AutoDeploy'],False),
            (('lambda','get-policy'),['Policy'],json.dumps({'Statement':[]})),
            (('cloudfront','get-distribution-config'),['DistributionConfig','Aliases','Items'],['other.test']),
            (('cloudfront','get-distribution-config'),['DistributionConfig','Origins','Items',0,'DomainName'],'other.s3.amazonaws.com'),
            (('cloudfront','get-distribution-config'),['DistributionConfig','Origins','Items',1,'DomainName'],'other.execute-api.us-east-1.amazonaws.com'),
            (('s3api','get-bucket-versioning'),['Status'],'Suspended'),
        ]
        for key,path,value in changes:
            with self.subTest(key=key,path=path):
                responses=copy.deepcopy(good); target=responses[key]
                for part in path[:-1]: target=target[part]
                target[path[-1]]=value
                with self.assertRaises(RuntimeError): run(responses)

    def test_aws_error_does_not_echo_provider_output(self):
        result=type('Result',(),{'returncode':1,'stdout':b'{"Code":{"Location":"synthetic-sensitive-url"}}','stderr':b'synthetic-sensitive-environment'})()
        with patch.object(r.subprocess,'run',return_value=result):
            with self.assertRaises(RuntimeError) as error: r.aws('lambda','get-function')
        self.assertNotIn('synthetic-sensitive',str(error.exception))

    def test_manifest_includes_nested_manifest_and_rejects_tampering_or_symlinks(self):
        self.assertIn('out/manifest.json', r.validate_bundle(self.bundle, SHA)['files'])
        (self.bundle/'out/index.html').write_text('tampered')
        with self.assertRaisesRegex(RuntimeError, 'mismatch'):
            r.validate_bundle(self.bundle, SHA)
        (self.bundle/'out/link').symlink_to('/etc/passwd')
        with self.assertRaisesRegex(RuntimeError, 'symlinks'):
            r.files_in(self.bundle)

    def test_feature_values_are_exact_booleans(self):
        for value in ({'multiBookInvites': 0, 'verifiedEmail': False}, {'multiBookInvites': False, 'verifiedEmail': True}):
            with self.assertRaises(RuntimeError):
                r.manifest(self.bundle, SHA, value)

    def test_route_plan_never_updates_existing_routes(self):
        existing = {'RouteKey': r.ROUTES[0], 'Target': 'integrations/'+r.INTEGRATION, 'AuthorizationType': 'NONE'}
        self.assertEqual(r.route_plan([existing]), r.ROUTES[1:])
        for changed in ({**existing, 'Target': 'integrations/wrong'}, {**existing, 'AuthorizationType': 'JWT'}):
            with self.assertRaisesRegex(RuntimeError, 'differs'):
                r.route_plan([changed])

    def test_invoke_policy_requires_complete_own_api_coverage(self):
        self.assertTrue(r.policy_covers_routes(policy()))
        self.assertFalse(r.policy_covers_routes(policy('arn:aws:execute-api:us-east-1:000000000000:wrong/*/*/*')))
        self.assertFalse(r.policy_covers_routes(policy(f'arn:aws:execute-api:{r.REGION}:{r.ACCOUNT}:{r.API}/*/GET/invitations')))
        denied = policy(); denied['Statement'].append({'Effect': 'Deny'})
        self.assertFalse(r.policy_covers_routes(denied))
        conditioned = policy(); conditioned['Statement'][0]['Condition']['StringEquals'] = {'AWS:SourceAccount': 'wrong'}
        self.assertFalse(r.policy_covers_routes(conditioned))
        exact = policy(); exact['Statement'] = []
        for route in r.ROUTES:
            method, path = route.split(' ', 1)
            exact['Statement'] += policy(f'arn:aws:execute-api:{r.REGION}:{r.ACCOUNT}:{r.API}/$default/{method}{path}')['Statement']
        self.assertTrue(r.policy_covers_routes(exact))
        exact['Statement'][2]['Condition']['ArnLike']['AWS:SourceArn'] = exact['Statement'][2]['Condition']['ArnLike']['AWS:SourceArn'].replace('{token}', 'example-token')
        self.assertFalse(r.policy_covers_routes(exact))

    def test_checks_pin_provider_and_latest_completed_exact_commit(self):
        env = {'GITHUB_REPOSITORY':r.REPOSITORY, 'GITHUB_REF':'refs/heads/main', 'GITHUB_EVENT_NAME':'workflow_dispatch', 'GITHUB_SHA':SHA}
        checks = [{'name': name, 'id':i, 'head_sha':SHA, 'app':{'id':57789 if name=='CodeQL' else 15368}, 'status':'completed', 'conclusion':'success'} for i,name in enumerate(sorted(r.REQUIRED_CHECKS))]
        def github(path):
            return {'object': {'sha':SHA}} if '/git/ref/' in path else {'check_runs':checks}
        with patch.dict(os.environ, env), patch.object(r, 'github', side_effect=github):
            r.assert_candidate(SHA)
            checks.append({**checks[0], 'id':999, 'conclusion':'failure'})
            with self.assertRaisesRegex(RuntimeError, 'CI'):
                r.assert_candidate(SHA)
            checks.pop(); checks[0]['app']['id'] = 42
            with self.assertRaisesRegex(RuntimeError, 'CI'):
                r.assert_candidate(SHA)
        with patch.dict(os.environ, {**env, 'GITHUB_REF':'refs/heads/other'}):
            with self.assertRaisesRegex(RuntimeError, 'only on main'):
                r.assert_candidate(SHA)

    def test_backup_reuses_matching_version_without_publishing(self):
        with patch.object(r, 'aws', return_value={'Versions':[function(), function('4')]}) as call:
            self.assertEqual(r.backup_version(function(), SHA)['Version'], '4')
            self.assertEqual(call.call_count, 1)

    def test_backup_publication_is_conditioned_and_no_raw_config_saved(self):
        with patch.object(r, 'aws', side_effect=[{'Versions':[function()]}, function('5')]) as call:
            self.assertEqual(r.backup_version(function(), SHA)['Version'], '5')
            args = call.call_args.args
            self.assertIn('--revision-id', args); self.assertIn('--code-sha256', args)
        wrong = function('5'); wrong['Environment']['Variables']['SECRET'] = 'synthetic'
        with patch.object(r, 'aws', side_effect=[{'Versions':[]}, wrong]):
            with self.assertRaisesRegex(RuntimeError, 'backup verification'):
                r.backup_version(function(), SHA)

    def save_state(self, live=None):
        live = live or function()
        self.state.mkdir()
        r.write_json(self.state/'snapshot.json', {'commit':SHA, 'createdAt':int(time.time()), 'revisionId':live['RevisionId'], 'configurationHash':r.configuration_hash(live), 'codeSha256':live['CodeSha256'], 'backupVersion':'4', 'backupVersionArn':r.FUNCTION_ARN+':4', 'routesBefore':[], 'siteVersions':[]})

    def test_concurrent_revision_change_stops_before_any_write(self):
        self.save_state()
        changed = function(); changed['RevisionId']='newer'
        with patch.object(r, 'inspect_live', return_value=(changed, [], r.ROUTES)), patch.object(r, 'aws') as call:
            with self.assertRaisesRegex(RuntimeError, 'changed after snapshot'):
                r.deploy(self.bundle, self.state, SHA)
            call.assert_not_called()

    def test_missing_backup_or_changed_site_stops_before_code_write(self):
        self.save_state()
        with patch.object(r, 'inspect_live', return_value=(function(), [], r.ROUTES)), patch.object(r, 'aws', side_effect=[function('4'), {'Versions':[{'IsLatest':True,'Key':'index.html','VersionId':'new'}]}]) as call:
            with self.assertRaisesRegex(RuntimeError, 'frontend changed'):
                r.deploy(self.bundle, self.state, SHA)
            self.assertFalse(any(c.args[1]=='update-function-code' for c in call.call_args_list))

    def test_publish_order_preserves_routes_assets_and_environment(self):
        self.save_state()
        after = function(); after['CodeSha256'] = r.base64.b64encode(r.hashlib.sha256(b'new-code').digest()).decode()
        routes = [{'RouteKey':key,'Target':'integrations/'+r.INTEGRATION,'AuthorizationType':'NONE'} for key in r.ROUTES]
        calls = []
        def aws(service, operation, *args, **kw):
            calls.append((service, operation, args))
            if operation=='get-function-configuration': return after if '--qualifier' not in args else function('4')
            if operation=='list-object-versions': return {'Versions':[]}
            if operation=='get-routes': return {'Items':routes}
            if operation=='create-invalidation': return {'Invalidation':{'Id':'synthetic'}}
            return {}
        with patch.object(r, 'inspect_live', return_value=(function(), [], r.ROUTES)), patch.object(r, 'aws', side_effect=aws), patch('builtins.print'):
            r.deploy(self.bundle, self.state, SHA)
        operations = [c[1] for c in calls]
        self.assertLess(operations.index('update-function-code'), operations.index('create-route'))
        self.assertLess(operations.index('create-route'), operations.index('put-object'))
        keys = [c[2][c[2].index('--key')+1] for c in calls if c[1]=='put-object']
        self.assertEqual(keys[-1], 'index.html')
        self.assertFalse(any(op in {'update-function-configuration','update-route','delete-route','delete-object'} for op in operations))

    def test_public_verification_requires_exact_bytes_and_same_origin_denial(self):
        from urllib.error import HTTPError
        class Response:
            def __init__(self,url,data): self.url,self.data=url,data
            def __enter__(self): return self
            def __exit__(self,*args): pass
            def geturl(self): return self.url
            def read(self): return self.data
        def fetch(url,timeout=30):
            if url.endswith('/auth-api/me'):
                raise HTTPError(url,401,'synthetic denial',{},None)
            return Response(url,(self.bundle/'out'/url.removeprefix(r.ORIGIN+'/')).read_bytes())
        with patch.object(r,'urlopen',side_effect=fetch),patch('builtins.print'):
            r.verify(self.bundle,self.state,SHA)
        def tampered(url,timeout=30): return Response(url,b'tampered')
        with patch.object(r,'urlopen',side_effect=tampered):
            with self.assertRaisesRegex(RuntimeError,'bytes'): r.verify(self.bundle,self.state,SHA)
        def foreign(url,timeout=30):
            if url.endswith('/auth-api/me'): raise HTTPError('https://other.test/me',401,'synthetic denial',{},None)
            return fetch(url,timeout)
        with patch.object(r,'urlopen',side_effect=foreign):
            with self.assertRaisesRegex(RuntimeError,'redirected'): r.verify(self.bundle,self.state,SHA)
        def successful(url,timeout=30):
            return Response(url,b'{}') if url.endswith('/auth-api/me') else fetch(url,timeout)
        with patch.object(r,'urlopen',side_effect=successful):
            with self.assertRaisesRegex(RuntimeError,'unexpectedly succeeded'): r.verify(self.bundle,self.state,SHA)

    def test_snapshot_target_failure_makes_no_backup_or_mutation(self):
        with patch.object(r, 'inspect_live', side_effect=RuntimeError('invoke policy absent')), patch.object(r, 'aws') as call:
            with self.assertRaisesRegex(RuntimeError, 'invoke policy'):
                r.snapshot(self.bundle, self.state, SHA)
            call.assert_not_called()
            self.assertFalse(self.state.exists())

if __name__ == '__main__':
    unittest.main()
