#!/usr/bin/env node
/** Prepare certificate validation in our hosted zone. Does NOT register a domain. */
import { execFileSync } from 'node:child_process';
const aws = (...args) => JSON.parse(execFileSync('aws', [...args, '--region', 'us-east-1', '--output', 'json'], { encoding: 'utf8' }));
const stack = aws('cloudformation', 'describe-stacks', '--stack-name', 'InferMusicDns').Stacks[0];
const zoneId = stack.Outputs.find(o => o.OutputKey === 'HostedZoneId').OutputValue;
const certificates = aws('acm', 'list-certificates').CertificateSummaryList;
let arn = certificates.find(c => c.DomainName === 'infermusic.ai' && ['PENDING_VALIDATION', 'ISSUED'].includes(c.Status))?.CertificateArn;
if (!arn) {
  arn = aws('acm', 'request-certificate', '--domain-name', 'infermusic.ai', '--subject-alternative-names', 'www.infermusic.ai', 'charts.infermusic.ai', 'scales.infermusic.ai', '--validation-method', 'DNS', '--idempotency-token', 'infermusic20261009', '--tags', 'Key=Project,Value=InferMusic').CertificateArn;
}
const certificate = aws('acm', 'describe-certificate', '--certificate-arn', arn).Certificate;
const records = certificate.DomainValidationOptions.map(o => o.ResourceRecord).filter(Boolean);
if (records.length !== 4) throw new Error('Certificate validation records are not ready. Run this command again shortly.');
const changes = records.map(r => ({ Action: 'UPSERT', ResourceRecordSet: { Name: r.Name, Type: r.Type, TTL: 300, ResourceRecords: [{ Value: r.Value }] } }));
aws('route53', 'change-resource-record-sets', '--hosted-zone-id', zoneId, '--change-batch', JSON.stringify({ Changes: changes }));
const nameservers = aws('route53', 'get-hosted-zone', '--id', zoneId).DelegationSet.NameServers;
console.log(JSON.stringify({ domain: 'infermusic.ai', hostedZoneId: zoneId, certificateArn: arn, status: certificate.Status, nameservers }, null, 2));
