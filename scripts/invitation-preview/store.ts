import {isDeepStrictEqual} from 'node:util';
// LOCAL SYNTHETIC PREVIEW ONLY. No AWS client or real credentials.
type Row=Record<string,any>;
export const rows=new Map<string,Row>();
const key=(r:Row)=>`${r.pk}|${r.sk}`;
export const put=(r:Row)=>rows.set(key(r),structuredClone(r));
export const get=(pk:string,sk:string)=>rows.get(key({pk,sk}));
function matches(row:Row|undefined,op:Row):boolean {
 const expr=op.ConditionExpression;
 if(!expr)return true;
 const v=op.ExpressionAttributeValues??{}, names=op.ExpressionAttributeNames??{};
 const clause=(s:string):boolean=>{
  s=s.trim();
  const absent=s.match(/^attribute_not_exists\((\w+)\)$/);if(absent)return row?.[absent[1]]===undefined;
  if(s==='attribute_exists(pk)')return !!row;
  if(s==='attribute_not_exists(acceptedBy)')return row?.acceptedBy===undefined;
  if(s==='attribute_not_exists(deliveryState)')return row?.deliveryState===undefined;
  const m=s.match(/^([#\w]+) (=|<|>) (:\w+)$/);if(!m)throw Error(`Unknown condition: ${s}`);
  const a=row?.[names[m[1]]??m[1]], b=v[m[3]];
  return a!==undefined&&(m[2]==='='?isDeepStrictEqual(a,b):m[2]==='<'?a<b:a>b);
 };
 return expr.split(' OR ').some((part:string)=>part.split(' AND ').every(clause));
}

export const TABLE='synthetic-preview';
export const ddb={send:async(command:any)=>{
 const input=command.input;
 if(input.Key&&!input.UpdateExpression)return {Item:structuredClone(rows.get(key(input.Key)))};
 if(!input.TransactItems)throw Error('Unsupported preview operation');
 const ops=input.TransactItems.map((o:Row)=>o.Put??o.Update??o.ConditionCheck);
 if(ops.length>100||new Set(ops.map((o:Row)=>key(o.Key??o.Item))).size!==ops.length)throw Error('Invalid transaction');
 if(ops.some((o:Row)=>!matches(rows.get(key(o.Key??o.Item)),o)))throw Object.assign(Error('cancel'),{name:'TransactionCanceledException'});
 for(const o of ops){if(o.Item)put(o.Item);else if(o.UpdateExpression){const row=rows.get(key(o.Key))!;const field=o.UpdateExpression.includes('acceptedBy')?'acceptedBy':'deliveryState';put({...row,[field]:o.ExpressionAttributeValues[field==='acceptedBy'?':sub':':state']});}}
 return {};
}};
