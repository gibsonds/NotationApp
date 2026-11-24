#!/usr/bin/env python3
"""Bounded Charts release helper. No IAM, provider, secret or song-data operations.
All mutating paths require a complete preflight + durable snapshot first. The
workflow runs this reviewed script from the exact checked-out main commit.
"""
import argparse, base64, fnmatch, hashlib, json, mimetypes, os, re, subprocess, sys, time
from pathlib import Path
from urllib.parse import quote, urlparse
from urllib.request import Request, urlopen

ACCOUNT = '637423285747'
REGION = 'us-east-1'
REPOSITORY = 'gibsonds/NotationApp'
FUNCTION = 'NotationAuth-Handler886CB40B-VONw1UHVaz0k'
FUNCTION_ARN = f'arn:aws:lambda:{REGION}:{ACCOUNT}:function:{FUNCTION}'
API = 'xg47257esd'
INTEGRATION = 'kpcfvrc'
BUCKET = 'notationauth-sitebucket397a1860-m0gyarsr1okt'
DISTRIBUTION = 'E1OQKQ4KGT4DXV'
ORIGIN = 'https://charts.collisionstorm.com'
ROUTES = ['POST /invitations', 'GET /invitations/capabilities',
          'GET /invitations/{token}', 'POST /invitations/{token}/accept']
REQUIRED_CHECKS = {'test', 'dependency-audit', 'security-tests', 'analyze'}
CODEQL_CATEGORY = '.github/workflows/codeql.yml:analyze'
MAIN_REF = 'refs/heads/main'


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + '\n')
    path.chmod(0o600)


def aws(service, operation, *args, output=True):
    command = ['aws', service, operation, '--region', REGION, '--no-cli-pager', *args]
    if output:
        command += ['--output', 'json']
    result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    # Never print complete AWS errors/responses: GetFunction has a signed code URL.
    require(result.returncode == 0, f'AWS {service} {operation} failed; no automatic mutation retry')
    return json.loads(result.stdout) if output and result.stdout.strip() else None


def github(path):
    token = os.environ.get('GH_TOKEN', '')
    require(token, 'GH_TOKEN required for exact-head checks')
    request = Request('https://api.github.com/' + path, headers={
        'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'NotationChartsRelease'})
    with urlopen(request, timeout=30) as response:
        return json.load(response)


def github_pages(path, key=None):
    """Bounded, complete evidence only; never accept a truncated result set."""
    result = []
    for page in range(1, 11):
        value = github(path + ('&' if '?' in path else '?') + f'per_page=100&page={page}')
        batch = value.get(key) if key and isinstance(value, dict) else value if not key else None
        require(isinstance(batch, list), 'GitHub evidence has an unexpected shape')
        result += batch
        if len(batch) < 100:
            return result
    raise RuntimeError('GitHub evidence pagination limit reached; review before release')


def require_checks(sha, names, app_id):
    checks = github_pages(f'repos/{REPOSITORY}/commits/{sha}/check-runs', 'check_runs')
    latest = {}
    for check in checks:
        if check.get('head_sha') == sha and check.get('name') in names and check.get('app', {}).get('id') == app_id:
            if check['id'] > latest.get(check['name'], {}).get('id', -1):
                latest[check['name']] = check
    require(all(latest.get(name, {}).get('status') == 'completed' and latest[name].get('conclusion') == 'success' for name in names),
            'Required exact-head CI is missing, pending or failed')


def require_codeql_proof(sha):
    # The GitHub severity check is PR-only. Preserve it through the normal
    # two-parent merge's last parent, and prove its complete source tree matches.
    candidate = github(f'repos/{REPOSITORY}/git/commits/{sha}')
    parents = candidate.get('parents', [])
    require(candidate.get('sha') == sha and len(parents) == 2,
            'Release proof requires a normal two-parent PR merge; squash/rebase need separate review')
    head = parents[-1]['sha']
    require(re.fullmatch('[a-f0-9]{40}', head), 'Unknown merged PR head identity')
    head_commit = github(f'repos/{REPOSITORY}/git/commits/{head}')
    tree = candidate.get('tree', {}).get('sha')
    require(head_commit.get('sha') == head and isinstance(tree, str) and re.fullmatch('[a-f0-9]{40}', tree) and
            tree == head_commit.get('tree', {}).get('sha'), 'Merged PR head tree differs from release; review and refresh PR checks')
    require_checks(head, {'CodeQL'}, 57789)

    analyses = github_pages(f'repos/{REPOSITORY}/code-scanning/analyses?ref=refs%2Fheads%2Fmain')
    matching = [a for a in analyses if a.get('commit_sha') == sha and a.get('ref') == MAIN_REF and
                a.get('tool', {}).get('name') == 'CodeQL' and a.get('category') == CODEQL_CATEGORY and
                a.get('analysis_key') == CODEQL_CATEGORY]
    require(matching, 'Processed exact-main CodeQL analysis is missing or stale')
    analysis = max(matching, key=lambda a: a['id'])
    require(type(analysis.get('id')) is int and analysis['id'] > 0 and
            analysis.get('error') == '' and analysis.get('warning') == '' and
            type(analysis.get('rules_count')) is int and analysis['rules_count'] > 0 and
            type(analysis.get('results_count')) is int and analysis['results_count'] == 0,
            'Exact-main CodeQL analysis has findings, warnings, errors or unknown rule coverage')

    # PR checks cover changed lines, so also inspect the full branch baseline.
    alerts = github_pages(f'repos/{REPOSITORY}/code-scanning/alerts?ref=refs%2Fheads%2Fmain&state=open')
    for alert in alerts:
        instance = alert.get('most_recent_instance', {})
        severity = alert.get('rule', {}).get('security_severity_level')
        require(alert.get('state') == 'open' and instance.get('state') == 'open' and
                instance.get('ref') == MAIN_REF and instance.get('commit_sha') == sha and
                severity in {'low', 'medium', 'high', 'critical'},
                'Open branch alert has stale or unknown security status')
        require(severity == 'low', 'Open branch security alert is medium or higher')


def assert_candidate(sha):
    require(re.fullmatch('[a-f0-9]{40}', sha), 'A full lowercase commit SHA is required')
    require(os.environ.get('GITHUB_REPOSITORY') == REPOSITORY, 'Wrong repository')
    require(os.environ.get('GITHUB_REF') == 'refs/heads/main', 'Release runs only on main')
    require(os.environ.get('GITHUB_EVENT_NAME') == 'workflow_dispatch', 'Manual dispatch required')
    require(os.environ.get('GITHUB_SHA') == sha, 'Dispatch/check-out SHA differs from requested SHA')
    require(github(f'repos/{REPOSITORY}/git/ref/heads/main')['object']['sha'] == sha,
            'main advanced; review and dispatch the new exact commit')
    require_checks(sha, REQUIRED_CHECKS, 15368)
    require_codeql_proof(sha)
    require(github(f'repos/{REPOSITORY}/git/ref/heads/main')['object']['sha'] == sha,
            'main advanced while checking release evidence')


def files_in(root):
    require(root.is_dir() and not root.is_symlink(), 'Missing or unsafe release directory')
    result = {}
    for path in root.rglob('*'):
        require(not path.is_symlink(), 'Release artifacts must not contain symlinks')
        if path.is_file() and path != root/'manifest.json':
            relative = path.relative_to(root).as_posix()
            result[relative] = {'sha256': digest(path.read_bytes()), 'size': path.stat().st_size}
    return result


def validate_features(config):
    require(isinstance(config, dict) and set(config) == {'multiBookInvites', 'verifiedEmail'} and
            all(type(value) is bool for value in config.values()), 'Invalid release feature config')
    require(not config['verifiedEmail'] or config['multiBookInvites'], 'Email requires multi-book flow')


def manifest(bundle, sha, config):
    require(re.fullmatch('[a-f0-9]{40}', sha), 'Invalid source commit')
    validate_features(config)
    require((bundle/'backend.zip').is_file() and (bundle/'out/index.html').is_file(), 'Incomplete artifact')
    write_json(bundle/'manifest.json', {'commit': sha, 'features': config, 'files': files_in(bundle)})


def validate_bundle(bundle, sha):
    data = json.loads((bundle/'manifest.json').read_text())
    validate_features(data['features'])
    require(data['commit'] == sha and data['files'] == files_in(bundle), 'Artifact manifest mismatch')
    require((bundle/'out/index.html').is_file() and (bundle/'backend.zip').is_file(), 'Missing release files')
    require(all(key == 'backend.zip' or key.startswith('out/') for key in data['files']), 'Unexpected artifact files')
    require(len(data['files']) <= 10000 and sum(f['size'] for f in data['files'].values()) <= 250 * 1024 * 1024,
            'Unexpected release artifact size')
    require(all(f['size'] <= 60 * 1024 * 1024 for f in data['files'].values()), 'Oversized release file')
    return data


def policy_covers_routes(policy):
    """Conservative check: existing service invocation must cover every new path.
    Do not grant AddPermission, ignore denials or weaken an existing policy.
    """
    statements = policy.get('Statement', [])
    if any(statement.get('Effect') == 'Deny' for statement in statements):
        return False
    for route in ROUTES:
        method, path = route.split(' ', 1)
        # HTTP API Lambda permissions use the route template, as CDK's
        # HttpLambdaIntegration bind does; preserve literal {token} here.
        source = f'arn:aws:execute-api:{REGION}:{ACCOUNT}:{API}/$default/{method}{path}'
        allowed = False
        for statement in statements:
            actions = statement.get('Action', [])
            actions = [actions] if isinstance(actions, str) else actions
            principal = statement.get('Principal', {})
            service = principal.get('Service') if isinstance(principal, dict) else None
            if statement.get('Effect') != 'Allow' or 'lambda:InvokeFunction' not in actions or service != 'apigateway.amazonaws.com':
                continue
            if statement.get('Resource') != FUNCTION_ARN:
                continue
            conditions = statement.get('Condition', {})
            if set(conditions) - {'ArnLike', 'StringLike', 'ArnEquals', 'StringEquals'}:
                continue
            matched = True
            source_checked = False
            for operator, clauses in conditions.items():
                for key, value in clauses.items():
                    values = [value] if isinstance(value, str) else value
                    if key.lower() == 'aws:sourcearn':
                        source_checked = True
                        matched &= any(('[' not in p and ']' not in p and fnmatch.fnmatchcase(source, p)) if operator.endswith('Like') else source == p for p in values)
                    elif key.lower() == 'aws:sourceaccount':
                        matched &= ACCOUNT in values
                    else:
                        matched = False
            allowed |= matched and source_checked
        if not allowed:
            return False
    return True


def route_plan(routes):
    by_key = {route['RouteKey']: route for route in routes}
    require(len(by_key) == len(routes), 'Duplicate route keys')
    missing = []
    for key in ROUTES:
        if key not in by_key:
            missing.append(key)
        else:
            require(by_key[key].get('Target') == 'integrations/' + INTEGRATION and
                    by_key[key].get('AuthorizationType', 'NONE') == 'NONE',
                    'Existing invitation route differs; no existing route is updated')
    return missing


def configuration_hash(config):
    # Retain no arbitrary environment variables or secret values in artifacts/logs.
    keys = ['Role', 'Runtime', 'Handler', 'Environment', 'Timeout', 'MemorySize', 'Architectures',
            'Layers', 'VpcConfig', 'DeadLetterConfig', 'KMSKeyArn', 'TracingConfig',
            'FileSystemConfigs', 'EphemeralStorage', 'SnapStart', 'LoggingConfig']
    return digest(json.dumps({k: config.get(k) for k in keys}, sort_keys=True).encode())


def backup_version(function, sha):
    versions = aws('lambda', 'list-versions-by-function', '--function-name', FUNCTION)['Versions']
    matching = [v for v in versions if v['Version'].isdigit() and
                v.get('CodeSha256') == function['CodeSha256'] and
                configuration_hash(v) == configuration_hash(function)]
    if matching:
        backup = max(matching, key=lambda v: int(v['Version']))
    else:
        backup = aws('lambda', 'publish-version', '--function-name', FUNCTION,
                     '--code-sha256', function['CodeSha256'], '--revision-id', function['RevisionId'],
                     '--description', 'Charts rollback before ' + sha)
    require(backup['Version'].isdigit() and backup['FunctionArn'] == FUNCTION_ARN + ':' + backup['Version'] and
            backup['CodeSha256'] == function['CodeSha256'] and
            configuration_hash(backup) == configuration_hash(function), 'Immutable Lambda backup verification failed')
    return backup


def inspect_live(features):
    identity = aws('sts', 'get-caller-identity')
    require(identity['Account'] == ACCOUNT and identity['Arn'].startswith(f'arn:aws:sts::{ACCOUNT}:assumed-role/NotationChartsRelease/'), 'Wrong deployment identity')
    function = aws('lambda', 'get-function-configuration', '--function-name', FUNCTION)
    require(function['FunctionArn'] == FUNCTION_ARN and function['Runtime'] == 'nodejs22.x' and function['Handler'] == 'index.handler', 'Unexpected Lambda target/runtime/handler')
    require(function.get('Version') == '$LATEST' and function.get('State') == 'Active' and
            function.get('LastUpdateStatus') == 'Successful' and
            isinstance(function.get('RevisionId'), str) and function['RevisionId'],
            'Live Lambda must be active with a successful update and known $LATEST revision')
    variables = function.get('Environment', {}).get('Variables', {})
    require(variables.get('COOKIE_SESSIONS') == '1' and ORIGIN in variables.get('APP_ORIGINS', '').split(','), 'Cookie/origin configuration mismatch')
    require((variables.get('MULTI_BOOK_INVITES') == '1') == features['multiBookInvites'] and (variables.get('VERIFIED_EMAIL_INVITES') == '1') == features['verifiedEmail'], 'Feature configuration differs; review separately, do not modify it here')
    api = aws('apigatewayv2', 'get-api', '--api-id', API)
    require(api['ProtocolType'] == 'HTTP' and api['ApiEndpoint'] == f'https://{API}.execute-api.{REGION}.amazonaws.com', 'Unexpected API')
    integrations = aws('apigatewayv2', 'get-integrations', '--api-id', API)['Items']
    matches = [i for i in integrations if i.get('IntegrationUri') == FUNCTION_ARN]
    require(len(matches) == 1 and matches[0]['IntegrationId'] == INTEGRATION and matches[0]['IntegrationType'] == 'AWS_PROXY' and matches[0].get('PayloadFormatVersion') == '2.0' and not matches[0].get('RequestParameters'), 'Unexpected integration target/mappings')
    stages = aws('apigatewayv2', 'get-stages', '--api-id', API)['Items']
    require(any(s['StageName'] == '$default' and s.get('AutoDeploy') is True for s in stages), 'Default stage must already auto-deploy')
    policy = json.loads(aws('lambda', 'get-policy', '--function-name', FUNCTION)['Policy'])
    require(policy_covers_routes(policy), 'Lambda invoke policy does not cover new routes; separate bounded setup needed')
    routes = aws('apigatewayv2', 'get-routes', '--api-id', API)['Items']
    missing = route_plan(routes)
    distribution = aws('cloudfront', 'get-distribution-config', '--id', DISTRIBUTION)['DistributionConfig']
    require('charts.collisionstorm.com' in distribution.get('Aliases', {}).get('Items', []), 'Unexpected CloudFront alias')
    default_id = distribution['DefaultCacheBehavior']['TargetOriginId']
    origins = [o for o in distribution['Origins']['Items'] if o['Id'] == default_id]
    require(len(origins) == 1 and origins[0]['DomainName'].startswith(BUCKET + '.s3.'), 'Unexpected website origin')
    api_behaviors = [b for b in distribution.get('CacheBehaviors', {}).get('Items', []) if b['PathPattern'].lstrip('/') == 'auth-api/*']
    api_origins = {o['Id']: o for o in distribution['Origins']['Items']}
    require(len(api_behaviors) == 1 and api_origins[api_behaviors[0]['TargetOriginId']]['DomainName'] == f'{API}.execute-api.{REGION}.amazonaws.com', 'Unexpected public API origin')
    require(aws('s3api', 'get-bucket-versioning', '--bucket', BUCKET).get('Status') == 'Enabled', 'Versioned bucket required for rollback provenance')
    return function, routes, missing


def inspect_release(bundle, state, sha):
    """Read-only first-run OIDC preflight: never snapshot/publish/write."""
    assert_candidate(sha)
    artifact = validate_bundle(bundle, sha)
    function, routes, missing = inspect_live(artifact['features'])
    print(json.dumps({'status': 'read-only-preflight-passed', 'productionChanged': False,
                      'commit': sha, 'account': ACCOUNT, 'region': REGION,
                      'functionArn': function['FunctionArn'], 'codeSha256': function['CodeSha256'],
                      'api': API, 'integration': INTEGRATION, 'bucket': BUCKET,
                      'distribution': DISTRIBUTION, 'origin': ORIGIN,
                      'features': artifact['features'], 'existingRouteCount': len(routes),
                      'missingInvitationRoutes': missing}, indent=2))


def snapshot(bundle, state, sha):
    artifact = validate_bundle(bundle, sha)
    function, routes, missing = inspect_live(artifact['features'])
    state.mkdir(mode=0o700, parents=True, exist_ok=False)
    versions = aws('s3api', 'list-object-versions', '--bucket', BUCKET).get('Versions', [])
    current = [v for v in versions if v.get('IsLatest')]
    require(current and len(current) <= 10000, 'Unexpected website inventory size')
    for item in current:
        key = item['Key']
        if key.endswith('.html'):
            require(not Path(key).is_absolute() and '..' not in Path(key).parts, 'Unsafe website key')
            target = state/'html-before'/key
            target.parent.mkdir(parents=True, exist_ok=True)
            aws('s3api', 'get-object', '--bucket', BUCKET, '--key', key, '--version-id', item['VersionId'], str(target))
    require((state/'html-before/index.html').is_file(), 'No website rollback HTML')
    # Publish a version inside Lambda, never copy the live ZIP/config into this
    # public repository's artifacts. Code/operational settings stay unchanged,
    # but publishing can rotate $LATEST's concurrency revision. Re-establish
    # that baseline only after verifying the live state against the backup.
    backup = backup_version(function, sha)
    latest, latest_routes, latest_missing = inspect_live(artifact['features'])
    require(latest['CodeSha256'] == function['CodeSha256'] == backup['CodeSha256'] and
            configuration_hash(latest) == configuration_hash(function) == configuration_hash(backup),
            'Live backend code or operational configuration changed during snapshot; review before retry')
    # The version's Description is intentionally overridden for provenance;
    # compare these additional static fields only between the two live reads.
    require(all(latest.get(key) == function.get(key) for key in ('Description', 'PackageType')),
            'Live backend static settings changed during snapshot; review before retry')
    require(sorted(latest_routes, key=lambda r: r['RouteKey']) == sorted(routes, key=lambda r: r['RouteKey']) and
            latest_missing == missing, 'Live routes changed during snapshot; review before retry')
    latest_versions = aws('s3api', 'list-object-versions', '--bucket', BUCKET).get('Versions', [])
    require({v['Key']: v['VersionId'] for v in current} ==
            {v['Key']: v['VersionId'] for v in latest_versions if v.get('IsLatest')},
            'Live frontend changed during snapshot; review before retry')
    write_json(state/'snapshot.json', {'commit': sha, 'configurationHash': configuration_hash(latest), 'revisionId': latest['RevisionId'], 'codeSha256': latest['CodeSha256'], 'backupVersionArn': backup['FunctionArn'], 'backupVersion': backup['Version'], 'routesBefore': latest_routes, 'missingRoutes': latest_missing, 'siteVersions': current, 'createdAt': int(time.time())})
    print('Targets revalidated; immutable Lambda version and versioned site rollback provenance saved. Live code/operational settings unchanged.')


def deploy(bundle, state, sha):
    artifact = validate_bundle(bundle, sha)
    before = json.loads((state/'snapshot.json').read_text())
    require(before['commit'] == sha and time.time() - before['createdAt'] < 1800, 'Snapshot is stale or for another commit')
    function, routes, missing = inspect_live(artifact['features'])
    require(function['RevisionId'] == before['revisionId'] and
            sorted(routes, key=lambda r: r['RouteKey']) == sorted(before['routesBefore'], key=lambda r: r['RouteKey']),
            'Live backend changed after snapshot; do not retry automatically')
    backup = aws('lambda', 'get-function-configuration', '--function-name', FUNCTION, '--qualifier', before['backupVersion'])
    require(backup['FunctionArn'] == before['backupVersionArn'] and backup['CodeSha256'] == before['codeSha256'] and
            configuration_hash(backup) == before['configurationHash'], 'Immutable rollback version no longer matches')
    current_versions = aws('s3api', 'list-object-versions', '--bucket', BUCKET).get('Versions', [])
    version_map = lambda items: {v['Key']: v['VersionId'] for v in items if v.get('IsLatest')}
    require(version_map(current_versions) == version_map(before['siteVersions']), 'Live frontend changed after snapshot; review before retry')
    aws('lambda', 'update-function-code', '--function-name', FUNCTION, '--revision-id', before['revisionId'], '--zip-file', 'fileb://' + str((bundle/'backend.zip').resolve()))
    aws('lambda', 'wait', 'function-updated-v2', '--function-name', FUNCTION, output=False)
    after = aws('lambda', 'get-function-configuration', '--function-name', FUNCTION)
    require(after['CodeSha256'] == base64.b64encode(hashlib.sha256((bundle/'backend.zip').read_bytes()).digest()).decode() and configuration_hash(after) == before['configurationHash'], 'Backend hash/configuration verification failed; stop before frontend writes')
    for route in missing:
        aws('apigatewayv2', 'create-route', '--api-id', API, '--route-key', route, '--target', 'integrations/' + INTEGRATION, '--authorization-type', 'NONE')
    new_routes = aws('apigatewayv2', 'get-routes', '--api-id', API)['Items']
    require(not route_plan(new_routes), 'Invitation routes are incomplete')
    new_by_key = {r['RouteKey']: r for r in new_routes}
    require(all(new_by_key.get(r['RouteKey']) == r for r in routes), 'An existing route changed concurrently; stop')
    # Bounded single PutObject uploads need no multipart/cleanup or delete rights.
    # Publish assets before HTML and retain all prior assets for already-open tabs.
    site_files = [key[4:] for key in artifact['files'] if key.startswith('out/')]
    for name in sorted(site_files, key=lambda n: (n.endswith('.html'), n)):
        content_type = mimetypes.guess_type(name)[0] or 'application/octet-stream'
        cache = 'no-cache, no-store, must-revalidate' if name.endswith('.html') else 'public, max-age=31536000, immutable' if name.startswith('_next/static/') else 'no-cache'
        aws('s3api', 'put-object', '--bucket', BUCKET, '--key', name, '--body', str(bundle/'out'/name), '--content-type', content_type, '--cache-control', cache)
    invalidation = aws('cloudfront', 'create-invalidation', '--distribution-id', DISTRIBUTION, '--paths', '/*')['Invalidation']['Id']
    write_json(state/'release.json', {'commit': sha, 'invalidationId': invalidation, 'backendCodeSha256': after['CodeSha256']})
    aws('cloudfront', 'wait', 'invalidation-completed', '--distribution-id', DISTRIBUTION, '--id', invalidation, output=False)
    print('Charts backend/routes/frontend published; invalidation completed. Live smoke remains required.')


def verify(bundle, state, sha):
    artifact = validate_bundle(bundle, sha)
    # Compare every generated frontend file byte-for-byte on the public site.
    for relative in artifact['files']:
        if not relative.startswith('out/'):
            continue
        name = relative[4:]
        require('..' not in Path(name).parts, 'Unsafe artifact path')
        with urlopen(ORIGIN + '/' + quote(name, safe='/'), timeout=30) as response:
            require(urlparse(response.geturl()).scheme == 'https' and urlparse(response.geturl()).netloc == urlparse(ORIGIN).netloc, 'Production asset redirected outside Charts')
            actual = response.read()
        require(digest(actual) == artifact['files'][relative]['sha256'], 'Production asset bytes do not match this release')
    # No sign-in, signup, import, invite or song mutation. A signed-out /me must
    # not return a successful authenticated payload. HTTP errors are expected.
    from urllib.error import HTTPError
    try:
        with urlopen(ORIGIN + '/auth-api/me', timeout=30):
            raise RuntimeError('Signed-out /me unexpectedly succeeded')
    except HTTPError as error:
        try:
            require(urlparse(error.geturl()).scheme == 'https' and urlparse(error.geturl()).netloc == urlparse(ORIGIN).netloc, 'Signed-out API redirected outside Charts')
            require(error.code == 401, 'Unexpected signed-out /me response')
        finally:
            error.close()
    print('Every generated production frontend file matches the exact artifact; signed-out /me denied. No user-data writes.')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['check-ci', 'manifest', 'validate', 'inspect', 'snapshot', 'deploy', 'verify'])
    parser.add_argument('--sha', required=True)
    parser.add_argument('--bundle', type=Path, default=Path('release-bundle'))
    parser.add_argument('--state', type=Path, default=Path('release-state'))
    args = parser.parse_args()
    if args.command == 'check-ci':
        assert_candidate(args.sha)
    elif args.command == 'manifest':
        manifest(args.bundle, args.sha, json.loads(Path('infra/release/charts-release-config.json').read_text()))
    elif args.command == 'validate':
        validate_bundle(args.bundle, args.sha)
    else:
        if args.command in {'snapshot', 'deploy'}:
            assert_candidate(args.sha)
        {'inspect': inspect_release, 'snapshot': snapshot, 'deploy': deploy, 'verify': verify}[args.command](args.bundle, args.state, args.sha)

if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Do not print arbitrary provider responses or signed URLs.
        print('Charts release stopped: ' + (str(error) if isinstance(error, RuntimeError) else type(error).__name__), file=sys.stderr)
        raise SystemExit(1)
