"""Release safety regressions. AWS/GitHub/network calls are mocked, never live."""
import contextlib, copy, importlib.util, io, json, os, shutil, subprocess, tempfile, time, unittest
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

    def test_preflight_mode_defaults_to_read_only_and_guards_deploy_steps(self):
        workflow = (Path(__file__).parents[2]/'.github/workflows/charts-release.yml').read_text()
        self.assertIn('default: preflight', workflow)
        self.assertIn('options: [preflight, deploy]', workflow)
        self.assertEqual(workflow.count('"$RELEASE_MODE" == preflight || "$RELEASE_MODE" == deploy'), 2)
        for step in workflow.split('      - name:')[1:]:
            if any(command in step for command in ('charts_release.py snapshot', 'charts_release.py deploy', 'charts_release.py verify')):
                self.assertIn("if: inputs.mode == 'deploy'", step)
        self.assertIn("if: always() && inputs.mode == 'deploy'", workflow)

    def test_preflight_checks_exact_candidate_and_targets_without_aws_writes(self):
        responses = self.live_responses()
        calls=[]
        def aws(service, op, *args, **kw):
            calls.append((service,op))
            self.assertIn((service,op), responses, 'read-only preflight attempted unexpected AWS operation')
            return copy.deepcopy(responses[(service,op)])
        output=io.StringIO()
        with patch.object(r,'assert_candidate') as candidate, patch.object(r,'aws',side_effect=aws), contextlib.redirect_stdout(output):
            r.inspect_release(self.bundle,self.state,SHA)
        candidate.assert_called_once_with(SHA)
        self.assertEqual(set(calls),set(responses))
        self.assertFalse(self.state.exists())
        result=json.loads(output.getvalue())
        self.assertFalse(result['productionChanged'])
        self.assertEqual(result['status'],'read-only-preflight-passed')
        self.assertEqual(result['missingInvitationRoutes'],r.ROUTES)
        self.assertNotIn('Environment',result)
        self.assertNotIn('Role',result)
        (self.bundle/'out/index.html').write_text('tampered')
        with patch.object(r,'assert_candidate'),patch.object(r,'aws') as call:
            with self.assertRaisesRegex(RuntimeError,'manifest mismatch'):
                r.inspect_release(self.bundle,self.state,SHA)
            call.assert_not_called()

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

    def proof_fixture(self):
        env = {'GITHUB_REPOSITORY':r.REPOSITORY, 'GITHUB_REF':'refs/heads/main', 'GITHUB_EVENT_NAME':'workflow_dispatch', 'GITHUB_SHA':SHA}
        prefix = 'repos/'+r.REPOSITORY
        head, tree = 'c'*40, 'd'*40
        checks = [{'name':name,'id':i+1,'head_sha':SHA,'app':{'id':15368},'status':'completed','conclusion':'success'} for i,name in enumerate(sorted(r.REQUIRED_CHECKS))]
        responses = {
            prefix+'/git/ref/heads/main':{'object':{'sha':SHA}},
            prefix+'/commits/'+SHA+'/check-runs':{'check_runs':checks},
            prefix+'/git/commits/'+SHA:{'sha':SHA,'tree':{'sha':tree},'parents':[{'sha':'b'*40},{'sha':head}]},
            prefix+'/git/commits/'+head:{'sha':head,'tree':{'sha':tree}},
            prefix+'/commits/'+head+'/check-runs':{'check_runs':[{'name':'CodeQL','id':100,'head_sha':head,'app':{'id':57789},'status':'completed','conclusion':'success'}]},
            prefix+'/code-scanning/analyses':[{'id':1,'ref':'refs/heads/main','commit_sha':SHA,'category':r.CODEQL_CATEGORY,'analysis_key':r.CODEQL_CATEGORY,'tool':{'name':'CodeQL'},'error':'','warning':'','rules_count':103,'results_count':0}],
            prefix+'/code-scanning/alerts':[],
        }
        def github(path):
            endpoint=path.split('?')[0]
            self.assertIn(endpoint,responses,'unexpected GitHub request')
            if '/code-scanning/' in path:
                self.assertIn('ref=refs%2Fheads%2Fmain',path)
            if endpoint.endswith('/alerts'):
                self.assertIn('state=open',path)
            return responses[endpoint]
        return env,responses,github

    def test_checks_pin_provider_and_latest_completed_exact_commit(self):
        env,responses,github=self.proof_fixture()
        checks=responses['repos/'+r.REPOSITORY+'/commits/'+SHA+'/check-runs']['check_runs']
        with patch.dict(os.environ,env),patch.object(r,'github',side_effect=github):
            r.assert_candidate(SHA)
            checks.append({**checks[0],'id':999,'conclusion':'failure'})
            with self.assertRaisesRegex(RuntimeError,'CI'): r.assert_candidate(SHA)
            checks.pop();checks[0]['app']['id']=42
            with self.assertRaisesRegex(RuntimeError,'CI'): r.assert_candidate(SHA)
        with patch.dict(os.environ,{**env,'GITHUB_REF':'refs/heads/other'}):
            with self.assertRaisesRegex(RuntimeError,'only on main'): r.assert_candidate(SHA)

    def test_codeql_analysis_requires_exact_processed_clean_main_evidence(self):
        changes=[('commit_sha','f'*40),('ref','refs/pull/1/merge'),('category','other'),
                 ('analysis_key','other'),('tool',{'name':'Other'}),('error','failed'),
                 ('warning','partial analysis'),('rules_count',0),('rules_count',None),
                 ('results_count',3),('results_count',None),('id',None)]
        for key,value in changes:
            with self.subTest(key=key):
                env,responses,github=self.proof_fixture()
                responses['repos/'+r.REPOSITORY+'/code-scanning/analyses'][0][key]=value
                with patch.dict(os.environ,env),patch.object(r,'github',side_effect=github):
                    with self.assertRaises(RuntimeError): r.assert_candidate(SHA)
        env,responses,github=self.proof_fixture()
        analyses=responses['repos/'+r.REPOSITORY+'/code-scanning/analyses']
        analyses.append({**analyses[0],'id':2,'results_count':1})
        with patch.dict(os.environ,env),patch.object(r,'github',side_effect=github):
            with self.assertRaisesRegex(RuntimeError,'findings'): r.assert_candidate(SHA)

    def test_pr_severity_proof_requires_normal_merge_identical_tree_and_success(self):
        prefix='repos/'+r.REPOSITORY
        for case in ['one-parent','tree-changed','wrong-app','wrong-head','failure','newer-failure']:
            with self.subTest(case=case):
                env,responses,github=self.proof_fixture()
                candidate=responses[prefix+'/git/commits/'+SHA]
                head=candidate['parents'][-1]['sha']
                checks=responses[prefix+'/commits/'+head+'/check-runs']['check_runs']
                if case=='one-parent': candidate['parents'].pop(0)
                elif case=='tree-changed': responses[prefix+'/git/commits/'+head]['tree']['sha']='e'*40
                elif case=='wrong-app': checks[0]['app']['id']=15368
                elif case=='wrong-head': checks[0]['head_sha']='f'*40
                elif case=='failure': checks[0]['conclusion']='failure'
                else: checks.append({**checks[0],'id':999,'status':'in_progress','conclusion':None})
                with patch.dict(os.environ,env),patch.object(r,'github',side_effect=github):
                    with self.assertRaises(RuntimeError): r.assert_candidate(SHA)

    def test_branch_baseline_alerts_fail_medium_or_unknown_and_stale_status(self):
        for case in ['medium','high','critical','unknown',None,'stale-ref','stale-sha','unknown-state']:
            with self.subTest(case=case):
                env,responses,github=self.proof_fixture()
                alert={'state':'open','rule':{'security_severity_level':case},'most_recent_instance':{'state':'open','ref':'refs/heads/main','commit_sha':SHA}}
                if case=='stale-ref': alert['rule']['security_severity_level']='low';alert['most_recent_instance']['ref']='refs/heads/other'
                if case=='stale-sha': alert['rule']['security_severity_level']='low';alert['most_recent_instance']['commit_sha']='f'*40
                if case=='unknown-state': alert['rule']['security_severity_level']='low';alert['most_recent_instance']['state']=None
                responses['repos/'+r.REPOSITORY+'/code-scanning/alerts']=[alert]
                with patch.dict(os.environ,env),patch.object(r,'github',side_effect=github):
                    with self.assertRaises(RuntimeError): r.assert_candidate(SHA)

    def test_github_evidence_denial_malformed_or_truncated_fails_closed(self):
        from urllib.error import HTTPError
        error=HTTPError('https://api.github.com/synthetic',403,'denied',{},None)
        self.addCleanup(error.close)
        env,responses,github=self.proof_fixture()
        def denied(path):
            if '/code-scanning/' in path: raise error
            return github(path)
        with patch.dict(os.environ,env),patch.object(r,'github',side_effect=denied),patch.object(r,'aws') as aws:
            with self.assertRaises(HTTPError): r.assert_candidate(SHA)
            aws.assert_not_called()
        with patch.object(r,'github',return_value={'unexpected':[]}):
            with self.assertRaisesRegex(RuntimeError,'unexpected shape'): r.github_pages('synthetic')
        with patch.object(r,'github',return_value=[{}]*100):
            with self.assertRaisesRegex(RuntimeError,'pagination limit'): r.github_pages('synthetic')
        with patch.object(r,'github',side_effect=[[{}]*100,None]):
            with self.assertRaisesRegex(RuntimeError,'unexpected shape'): r.github_pages('synthetic')

    def test_main_change_during_proof_is_rejected(self):
        env,responses,github=self.proof_fixture()
        reads=0
        def advanced(path):
            nonlocal reads
            if '/git/ref/' in path:
                reads+=1
                if reads==2: return {'object':{'sha':'f'*40}}
            return github(path)
        with patch.dict(os.environ,env),patch.object(r,'github',side_effect=advanced):
            with self.assertRaisesRegex(RuntimeError,'advanced while'): r.assert_candidate(SHA)

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
