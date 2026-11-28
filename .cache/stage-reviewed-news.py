import sys,json
from pathlib import Path
sys.path.insert(0,'scripts')
from update_sources import news_candidate
from update_pipeline import read_json,write_json,digest,merge_candidate
root=Path('.'); jobs={j['id']:j for j in read_json(root/'data/updates/queue.json')['jobs']}
candidates=read_json(root/'data/updates/candidates.json',{})
data=[
('news-cf217e8992fae649feb6','https://www.globenewswire.com/news-release/2026/03/27/3263732/0/en/Glucotrack-to-File-Significant-IDE-with-FDA-for-US-Clinical-Trial-in-Early-Q2-Based-on-Critical-2025-Milestones.html','Glucotrack to File Significant IDE with FDA for US Clinical Trial in Early Q2 Based on Critical 2025 Milestones','2026-03-27T08:01:00-04:00','GlobeNewswire','Glucotrack reported clinical and operational milestones and an aim to submit an investigational device exemption for its implantable glucose monitoring system in Q2 2026; a US trial remained subject to FDA approval.'),
('news-86214e4f2ac788b1624f','https://www.prnewswire.com/news-releases/lunai-bioworks-executes-20m-strategic-transaction-at-fixed-1-50-conversion-acquiring-bbb-delivery-platform-for-cns-alzheimers-therapies-with-broad-cns-delivery-applications-302726205.html',"Lunai Bioworks Executes $20M Strategic Transaction at Fixed $1.50 Conversion, Acquiring BBB Delivery Platform for CNS Alzheimer's Therapies with Broad CNS Delivery Applications",'2026-03-26T08:50:00-04:00','PR Newswire','Lunai announced a binding $20 million agreement to acquire blood-brain barrier technology and CNS drug assets, structured using convertible preferred shares; completion remained subject to transaction risks.')]
decisions={'schemaVersion':1,'reviewer':'Codex','reviewedOn':'2026-11-28','items':[],'jobReviews':[]}
for jobid,url,title,timestamp,publisher,summary in data:
 job=jobs[jobid]
 item={'headline':title,'sourceUrl':url,'publicationDate':timestamp[:10],'publishedAt':timestamp,'publisher':publisher,'excerpt':summary}
 receipt={'url':url,'sha256':digest(item),'fetchedAt':'2026-11-28','access':'reviewed_web_excerpt'}
 c=news_candidate(item,job,receipt,{'hours':48,'dateFallbackDays':2}); assert c and c['entries']
 c['proposal']['timePrecision']='minute'; c['evidenceMethod']='Reviewed original distributor page and publication metadata via web; receipt hash identifies the recorded excerpt, not the full response.'
 merge_candidate(candidates,c)
 decisions['items'].append({'candidateId':c['id'],'evidenceHash':c['evidenceHash'],'action':'accept','issuerCik':job['cik'],'identityEvidence':f'Original distributor identifies {job["issuerNames"][0]} and {job["symbols"][0]}; issuer profile CIK {job["cik"]}.','summary':summary,'publisher':publisher,'kind':'issuer_release','timePrecision':'minute','timestampEvidence':f'Original distributor displays {timestamp[:10]} {timestamp[11:16]} ET; daylight time applies.','sourceWarnings':['Claims are attributed to the issuer and are not independent verification.']})
 decisions['jobReviews'].append({'jobId':jobid,'fingerprint':job['fingerprint'],'windowReviewed':True,'sources':[{'url':url,'access':'reviewed','note':'Original distributor publication and timestamp; non-exhaustive historical research.'}],'limitations':['Coverage is partial; other publications may exist.']})
 print(jobid,c['id'],'matching_entries',len(c['entries']))
write_json(root/'data/updates/candidates.json',candidates)
write_json(root/'data/updates/reviewed-2026-11-28-batch.json',decisions)
