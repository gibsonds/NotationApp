"""Read-only configuration checks. Never reads songs, secrets, logs or token values."""
import json, subprocess, sys

def aws(*args):
    result=subprocess.run(['aws',*args,'--region','us-east-1','--output','json'],capture_output=True,text=True)
    if result.returncode: raise RuntimeError('Metadata check unavailable: '+' '.join(args[:2]))
    return json.loads(result.stdout or '{}')
checks=[]
def check(name, passed):
    checks.append({'check':name,'passed':bool(passed)})
fn='NotationAuth-Handler886CB40B-VONw1UHVaz0k'
config=aws('lambda','get-function-configuration','--function-name',fn)
env=config.get('Environment',{}).get('Variables',{})
check('OAuth audience is required',bool(env.get('OAUTH_AUDIENCE')))
check('Production stub disabled',env.get('AUTH_STUB')!='1')
check('Opaque cookie sessions enabled',env.get('COOKIE_SESSIONS')=='1')
check('OAuth client secret is referenced, not inline',bool(env.get('OAUTH_CLIENT_SECRET_ID')) and not env.get('OAUTH_CLIENT_SECRET'))
check('Supported Lambda runtime',config['Runtime'] in ['nodejs22.x','nodejs24.x'])
reserved=aws('lambda','get-function-concurrency','--function-name',fn).get('ReservedConcurrentExecutions',0)
account_limit=aws('lambda','get-account-settings')['AccountLimit']['ConcurrentExecutions']
check('Bounded Lambda concurrency (function or account)',0 < (reserved or account_limit) <= 20)
for table in ['NotationAppAuth','NotationApp']:
 info=aws('dynamodb','describe-table','--table-name',table)['Table']
 backup=aws('dynamodb','describe-continuous-backups','--table-name',table)['ContinuousBackupsDescription']
 check(table+' deletion protection',info.get('DeletionProtectionEnabled'))
 check(table+' recovery enabled',backup.get('PointInTimeRecoveryDescription',{}).get('PointInTimeRecoveryStatus')=='ENABLED')
for api in ['xg47257esd','vv4fx6t7i1']:
 stage=aws('apigatewayv2','get-stages','--api-id',api)['Items'][0]
 check(api+' rate limits',0 < stage.get('DefaultRouteSettings',{}).get('ThrottlingRateLimit',0)<=30)
 log=stage.get('AccessLogSettings',{}).get('Format','')
 check(api+' minimal access logs',bool(log) and all(x not in log for x in ['sourceIp','userAgent','authorizer','queryString']))
bucket='notationauth-sitebucket397a1860-m0gyarsr1okt'
check('Static bucket versioning',aws('s3api','get-bucket-versioning','--bucket',bucket).get('Status')=='Enabled')
check('Static bucket blocks public access',all(aws('s3api','get-public-access-block','--bucket',bucket)['PublicAccessBlockConfiguration'].values()))
cf=aws('cloudfront','get-distribution-config','--id','E1OQKQ4KGT4DXV')['DistributionConfig']
check('Security response headers attached',bool(cf['DefaultCacheBehavior'].get('ResponseHeadersPolicyId')))
check('Same-origin API cache disabled',any(x['PathPattern']=='/auth-api/*' and x.get('CachePolicyId')=='4135ea2d-6df8-44a3-9df3-4b5a84be39ad' for x in cf.get('CacheBehaviors',{}).get('Items',[])))
# The stable AWS managed CachingDisabled ID is checked from the deployed policy reference.
print(json.dumps({'checks':checks},indent=2))
sys.exit(0 if all(c['passed'] for c in checks) else 1)
