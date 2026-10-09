"""Remove historical member emails without retrieving email values or song content.

Defaults to a count-only preview; --apply conditionally removes only Member.email.
Recovery points retain prior values until their normal retention expires.
"""
import json
import subprocess
import sys

def aws(*args):
    result = subprocess.run(['aws', *args, '--region', 'us-east-1', '--output', 'json'], capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError('Member privacy migration failed; no data values logged.')
    return json.loads(result.stdout or '{}')

cursor = None
count = 0
while True:
    args = ['dynamodb', 'scan', '--table-name', 'NotationAppAuth',
            '--projection-expression', 'pk,sk',
            '--filter-expression', 'entity = :member AND attribute_exists(email)',
            '--expression-attribute-values', json.dumps({':member': {'S': 'Member'}}),
            '--no-paginate', '--consistent-read']
    if cursor:
        args += ['--exclusive-start-key', json.dumps(cursor)]
    page = aws(*args)
    for item in page.get('Items', []):
        if '--apply' in sys.argv:
            aws('dynamodb', 'update-item', '--table-name', 'NotationAppAuth',
                '--key', json.dumps(item), '--update-expression', 'REMOVE email',
                '--condition-expression', 'entity = :member',
                '--expression-attribute-values', json.dumps({':member': {'S': 'Member'}}))
        count += 1
    cursor = page.get('LastEvaluatedKey')
    if not cursor:
        break
print(json.dumps({'member_records': count, 'applied': '--apply' in sys.argv}))
