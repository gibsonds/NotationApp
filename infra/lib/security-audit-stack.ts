import { CfnOutput, Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { ArnPrincipal, FederatedPrincipal, CfnOIDCProvider, ManagedPolicy, PolicyStatement, Role, User } from 'aws-cdk-lib/aws-iam';

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
  // Console password and MFA are enrolled by the owner outside CloudFormation.
  // No permanent access key is created. `aws login` supplies temporary credentials.
  const developer=new User(this,'FrontendDeveloper',{
   userName:'InferMusicDeploy',
   managedPolicies:[ManagedPolicy.fromAwsManagedPolicyName('SignInLocalDevelopmentAccess')],
  });
  developer.applyRemovalPolicy(RemovalPolicy.RETAIN);
  deploy.assumeRolePolicy!.addStatements(new PolicyStatement({
   actions:['sts:AssumeRole'],principals:[developer],
   conditions:{Bool:{'aws:MultiFactorAuthPresent':'true'}},
  }));
  developer.addToPolicy(new PolicyStatement({
   actions:['sts:AssumeRole'],resources:[deploy.roleArn],
   conditions:{Bool:{'aws:MultiFactorAuthPresent':'true'}},
  }));
  developer.addToPolicy(new PolicyStatement({
   actions:['iam:GetUser','iam:ListMFADevices'],resources:[developer.userArn],
  }));
  // Explicitly selected maintenance access; never use this as the default profile.
  // Records can be repaired, but tables, IAM, and infrastructure cannot be changed.
  const repair=new Role(this,'SongRepairRole',{
   roleName:'NotationSongRepair',maxSessionDuration:Duration.hours(1),
   assumedBy:new ArnPrincipal(developer.userArn).withConditions({'Bool':{'aws:MultiFactorAuthPresent':'true'}}),
  });
  developer.addToPolicy(new PolicyStatement({
   actions:['sts:AssumeRole'],resources:[repair.roleArn],
   conditions:{Bool:{'aws:MultiFactorAuthPresent':'true'}},
  }));
  const songTables=['NotationAppAuth','NotationApp'].map(name=>`arn:aws:dynamodb:${this.region}:${this.account}:table/${name}`);
  repair.addToPolicy(new PolicyStatement({
   actions:['dynamodb:DescribeTable','dynamodb:DescribeContinuousBackups','dynamodb:CreateBackup',
    'dynamodb:GetItem','dynamodb:BatchGetItem','dynamodb:Query','dynamodb:Scan',
    'dynamodb:PutItem','dynamodb:UpdateItem','dynamodb:DeleteItem','dynamodb:BatchWriteItem','dynamodb:ConditionCheckItem'],
   resources:songTables,
  }));
  repair.addToPolicy(new PolicyStatement({actions:['dynamodb:Query','dynamodb:Scan'],resources:songTables.map(table=>`${table}/index/*`)}));
  repair.addToPolicy(new PolicyStatement({actions:['dynamodb:DescribeBackup'],resources:songTables.map(table=>`${table}/backup/*`)}));
  for(const bucket of ['notationauth-sitebucket397a1860-m0gyarsr1okt','infermusic-sitebucket397a1860-lj4tyzy8yydi']) {
   deploy.addToPolicy(new PolicyStatement({actions:['s3:ListBucket'],resources:[`arn:aws:s3:::${bucket}`]}));
   deploy.addToPolicy(new PolicyStatement({actions:['s3:GetObject','s3:PutObject'],resources:[`arn:aws:s3:::${bucket}/*`]}));
  }
  deploy.addToPolicy(new PolicyStatement({actions:['cloudfront:CreateInvalidation','cloudfront:GetInvalidation'],resources:['E1OQKQ4KGT4DXV','E3UOVC33FJ47XE','E3O931JKSWWJGM'].map(x=>`arn:aws:cloudfront::${this.account}:distribution/${x}`)}));
  deploy.addToPolicy(new PolicyStatement({actions:['cloudformation:DescribeStacks'],resources:['NotationAuth','InferMusic'].map(x=>`arn:aws:cloudformation:${this.region}:${this.account}:stack/${x}/*`)}));
  new CfnOutput(this,'AuditRoleArn',{value:audit.roleArn});
  new CfnOutput(this,'FrontendRoleArn',{value:deploy.roleArn});
  new CfnOutput(this,'FrontendLoginUser',{value:developer.userName});
  new CfnOutput(this,'SongRepairRoleArn',{value:repair.roleArn});
 }
}
