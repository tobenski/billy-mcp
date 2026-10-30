"""Verify saved E2E evidence locally; never uploads data or writes to Billy."""
import json, sys
from decimal import Decimal
from pathlib import Path

x=json.loads(Path(sys.argv[1]).read_text()); s=x['state']; a=x['accounts']; checks=[]
def check(name, actual, expected):
    ok=actual==expected
    checks.append(dict(name=name,passed=ok,actual=actual,expected=expected))
def totals(lines):
    out={k:Decimal('0') for k in a}
    for l in lines:
        k=next(k for k,v in a.items() if v==l['accountId'])
        out[k]+=Decimal(str(l['amount']))*(1 if l['side']=='debit' else -1)
    return {k:f'{v:.2f}' for k,v in out.items()}
for k in 'ABCDEFGHIJ':
    check(k+' upload and attachment',bool(s[k].get('upload') and s[k].get('attachment')),True)
    check(k+' document annotation',bool(s[k].get('facts')),True)
    check(k+' download',s[k]['download']['originalMatches'],k!='E')
    if k!='J':
        d=s[k]['finalDraft']
        check(k+' final state',d['daybookTransaction']['state'],'draft' if k in 'ABCDEFG' else 'approved')
        check(k+' original attachment',len(d['attachments']),1)
        check(k+' balance',f"{sum(Decimal(str(l['amount']))*(1 if l['side']=='debit' else -1) for l in d['daybookTransactionLines']):.2f}",'0.00')
check('PNG downloaded visual check',s['E'].get('visualDownloadVerified'),True)
check('C review resolved',[r['status'] for r in s['C']['finalDocument']['reviews']],['resolved'])
check('G review open',[r['status'] for r in s['G']['finalDocument']['reviews']],['open'])
check('G amount unknown',s['G']['finalDocument']['documentFacts']['values']['totalAmount'],None)
check('H review resolved',[r['status'] for r in s['H']['bookFinal']['reviews']],['resolved'])
check('J absent',s['J']['draftId'] in [d['id'] for d in x['finalList']['daybookTransactions']],False)
check('J removal succeeded',bool(s['J']['removed']),True)
for c in x['checks']:check(c['name'],c['pass'],True)
booked=[]
for k,field in [('H','bookFinal'),('H','correctionBookedFinal'),('I','bookFinal'),('I','reversalBookedFinal')]:
    t=s[k][field];booked+=t['reviewSource']['postings']
    check(k+' '+field+' original retained',t['transaction']['isVoided'],False)
    check(k+' '+field+' file preserved',[z['attachment']['fileId'] for z in t['reviewSource']['attachments']],[s[k]['attachment']['fileId']])
check('I reversal net',totals(s['I']['bookFinal']['reviewSource']['postings']+s['I']['reversalBookedFinal']['reviewSource']['postings']),dict(subscription='0.00',office='0.00',equipment='0.00',bank='0.00'))
check('Current batch booked effect',totals(booked),dict(subscription='0.00',office='60.00',equipment='-60.00',bank='0.00'))
ready=[l for k in 'ABCDEF' for l in s[k]['finalDraft']['daybookTransactionLines']]
check('Expected effect after bank phase',totals(booked+ready),dict(subscription='120.00',office='330.10',equipment='985.15',bank='-1435.25'))
final={d['id']:d for d in x['finalList']['daybookTransactions']}
for old in x['baseline']['daybookTransactions']:
    check('Existing daybook header preserved '+old['id'],final.get(old['id']),old)
report=dict(batch=x['manifest']['batch'],phase='PRE_BANK_IMPORT',passed=sum(c['passed'] for c in checks),failed=sum(not c['passed'] for c in checks),checks=checks,bank_phase='NOT RUN: user CSV import required')
Path(sys.argv[2]).write_text(json.dumps(report,ensure_ascii=False,indent=2))
print(json.dumps({k:v for k,v in report.items() if k!='checks'}))
for c in checks:
    if not c['passed']:print(c)
sys.exit(1 if report['failed'] else 0)
