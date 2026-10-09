"""One-time migration of OUR OAuth client secret; no value printed; private temporary input is removed immediately."""
import json, subprocess, tempfile, os

def aws(*args, data=None):
    temp = None
    if data:
        temp = tempfile.NamedTemporaryFile(mode='w', prefix='notation-secret-', delete=False)
        os.chmod(temp.name, 0o600)
        json.dump(data, temp); temp.close()
        args = tuple('file://' + temp.name if x == 'file:///dev/stdin' else x for x in args)
    try:
        result = subprocess.run(['aws', *args, '--region', 'us-east-1', '--output', 'json'], input=json.dumps(data) if data else None, text=True, capture_output=True)
    finally:
        if temp: os.unlink(temp.name)
    if result.returncode: raise RuntimeError('AWS operation failed: ' + result.stderr.replace((data or {}).get('SecretString', '__none__'), '[REDACTED]'))
    return json.loads(result.stdout or '{}')
name = 'NotationApp/oauth42/client-secret'
exists = subprocess.run(['aws','secretsmanager','describe-secret','--secret-id',name,'--region','us-east-1'],capture_output=True)
if exists.returncode == 0:
    print('OAuth secret already prepared. No change.')
else:
    env = aws('lambda','get-function-configuration','--function-name','NotationAuth-Handler886CB40B-VONw1UHVaz0k')['Environment']['Variables']
    secret = env.get('OAUTH_CLIENT_SECRET')
    if not secret: raise RuntimeError('No deployed client secret to migrate; refusing to create an empty secret.')
    aws('secretsmanager','create-secret','--cli-input-json','file:///dev/stdin',data={'Name':name,'SecretString':secret,'Description':'NotationApp OAuth42 client credential (not user API keys)'})
    print('OAuth secret copied into Secrets Manager; value suppressed.')
