import { CfnOutput, Duration, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { ArnPrincipal, FederatedPrincipal, CfnOIDCProvider, PolicyStatement, Role } from 'aws-cdk-lib/aws-iam';

export class SecurityAuditStack extends Stack {
 constructor(scope:Construct,id:string,props:StackProps) {
  super(scope,id,props);
  const provider=new CfnOIDCProvider(this,'GitHubOidc',{url:'https://token.actions.githubusercontent.com',clientIdList:['sts.amazonaws.com']});
  const audit=new Role(this,'AuditRole',{
   roleName:'NotationSecurityAudit',maxSessionDuration:Duration.hours(1),
   assumedBy:new FederatedPrincipal(provider.ref,{'StringEquals':{
    'token.actions.githubusercontent.com:aud':'sts.amazonaws.com',
    'token.actions.githubusercontent.com:sub':'repo:gibsonds/NotationApp:ref:refs/heads/main',
   }},'sts:AssumeRoleWithWebIdentity'),
  });
  audit.addToPolicy(new PolicyStatement({actions:['lambda:GetAccountSettings'],resources:['*']}));
  // Metadata only. No song reads, bucket object reads, secret reads, or mutations.
  audit.addToPolicy(new PolicyStatement({actions:['lambda:GetFunctionConfiguration','lambda:GetFunctionConcurrency'],resources:[`arn:aws:lambda:${this.region}:${this.account}:function:NotationAuth-*`,`arn:aws:lambda:${this.region}:${this.account}:function:NotationProd-*`]}));
  audit.addToPolicy(new PolicyStatement({actions:['dynamodb:DescribeTable','dynamodb:DescribeContinuousBackups'],resources:[`arn:aws:dynamodb:${this.region}:${this.account}:table/NotationApp*`]}));
  audit.addToPolicy(new PolicyStatement({actions:['apigateway:GET'],resources:[`arn:aws:apigateway:${this.region}::/apis/xg47257esd/stages`,`arn:aws:apigateway:${this.region}::/apis/vv4fx6t7i1/stages`]}));
  audit.addToPolicy(new PolicyStatement({actions:['cloudfront:GetDistributionConfig'],resources:[`arn:aws:cloudfront::${this.account}:distribution/E1OQKQ4KGT4DXV`]}));
  audit.addToPolicy(new PolicyStatement({actions:['s3:GetBucketVersioning','s3:GetBucketPublicAccessBlock','s3:GetBucketPolicyStatus'],resources:['arn:aws:s3:::notationauth-sitebucket397a1860-m0gyarsr1okt']}));
  const deploy=new Role(this,'FrontendRole',{
   roleName:'NotationFrontendDeploy',maxSessionDuration:Duration.hours(1),
   assumedBy:new ArnPrincipal(`arn:aws:iam::${this.account}:user/GuitarProjectAdmin`).withConditions({'Bool':{'aws:MultiFactorAuthPresent':'true'}}),
  });
  for(const bucket of ['notationauth-sitebucket397a1860-m0gyarsr1okt','infermusic-sitebucket397a1860-lj4tyzy8yydi']) {
   deploy.addToPolicy(new PolicyStatement({actions:['s3:ListBucket'],resources:[`arn:aws:s3:::${bucket}`]}));
   deploy.addToPolicy(new PolicyStatement({actions:['s3:GetObject','s3:PutObject'],resources:[`arn:aws:s3:::${bucket}/*`]}));
  }
  deploy.addToPolicy(new PolicyStatement({actions:['cloudfront:CreateInvalidation','cloudfront:GetInvalidation'],resources:['E1OQKQ4KGT4DXV','E3UOVC33FJ47XE','E3O931JKSWWJGM'].map(x=>`arn:aws:cloudfront::${this.account}:distribution/${x}`)}));
  deploy.addToPolicy(new PolicyStatement({actions:['cloudformation:DescribeStacks'],resources:['NotationAuth','InferMusic'].map(x=>`arn:aws:cloudformation:${this.region}:${this.account}:stack/${x}/*`)}));
  new CfnOutput(this,'AuditRoleArn',{value:audit.roleArn});
  new CfnOutput(this,'FrontendRoleArn',{value:deploy.roleArn});
 }
}
