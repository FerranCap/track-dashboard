import json, subprocess, sys
jobs=['prices-9c5789d3df8ffcd25826','prices-ad51573d2e57e60fb02c','prices-cf47f7b5e8e05a9ab45e']
total=0.001415669919
for job in jobs:
    remaining=0.01-total
    quote=subprocess.run([sys.executable,'scripts/update_data.py','prices','--job',job,'--max-cost-usd',str(remaining)],capture_output=True,text=True,encoding='utf8',errors='replace')
    if quote.returncode: print(job,'quote_failed',quote.stderr[-400:],flush=True); continue
    info=json.loads(quote.stdout)['prices']
    print(job,'preflight',info.get('status'),info.get('estimatedCostUsd'),flush=True)
    if info.get('status')!='quote_only' or info.get('recordCount',0)==0: continue
    execute=subprocess.run([sys.executable,'scripts/update_data.py','prices','--job',job,'--max-cost-usd',str(remaining),'--execute-download'],capture_output=True,text=True,encoding='utf8',errors='replace')
    if execute.returncode: print(job,'execution_failed',execute.stderr[-500:],flush=True); break
    result=json.loads(execute.stdout)['prices']
    if result.get('status')=='downloaded': total+=result['estimatedCostUsd']
    print(job,result.get('status'),'estimated_total',round(total,10),flush=True)
print('FINAL_ESTIMATED_TOTAL',round(total,10),flush=True)
