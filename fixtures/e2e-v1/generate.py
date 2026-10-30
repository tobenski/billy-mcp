"""Generate synthetic end-to-end fixtures. No credentials or live Billy IDs."""
from pathlib import Path
from decimal import Decimal
import json, uuid, csv, sys, subprocess
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

out=Path(sys.argv[1]); (out/'bilag').mkdir(parents=True,exist_ok=True)
font='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
pdfmetrics.registerFont(TTFont('DV',font))
batch='E2E-20261030-01'
cases=[
 dict(key='A',title='Abonnement',amount='120.00',lines=[['Abonnement', '120.00']],account='subscription',bank=True),
 dict(key='B',title='Fordelt køb',amount='125.00',lines=[['Kontorartikler','80.00'],['Småanskaffelser','45.00']],account='split',bank=True),
 dict(key='C',title='Kontorartikler - fejl i første kladde',amount='240.00',lines=[['Kontorartikler','240.00']],account='office',bank=True),
 dict(key='D',title='Småanskaffelse',amount='999.95',lines=[['Testudstyr','999.95']],account='equipment',bank=True),
 dict(key='E',title='Ørebeløb',amount='0.30',lines=[['Kontorartikler','0.10'],['Småanskaffelse','0.20']],account='cents',bank=True),
 dict(key='F',title='Kreditnota - refundering',amount='50.00',lines=[['Retur af kontorartikler','-50.00']],account='refund',bank=True),
 dict(key='G',title='Manglende bilag - må ikke bogføres',amount='75.00',lines=[['Uafklaret bankbetaling','75.00']],account='missing',bank=True),
 dict(key='H',title='Intern ompostering - bogført fejl',amount='60.00',lines=[['Fra småanskaffelser til kontor','60.00']],account='correction',bank=False),
 dict(key='I',title='Intern post som skal tilbageføres',amount='25.00',lines=[['Midlertidig intern testpost','25.00']],account='reversal',bank=False),
 dict(key='J',title='Annulleret kladde',amount='13.00',lines=[['Annulleret testkøb','13.00']],account='delete',bank=False),
]
ops={}
for c in cases:
 c['voucher']=batch+'-'+c['key'];c['date']='2026-10-'+str(10+ord(c['key'])-ord('A')).zfill(2)
 for action in ['upload','create','attach','facts','review','resolve','update','book','correct','book-correction','reverse','book-reversal','delete','replay-conflict','stale','link','unlink','relink','approve']:
  ops[c['key']+':'+action]=str(uuid.uuid5(uuid.NAMESPACE_URL,batch+'/'+c['key']+'/'+action))
 c['file']='bilag/'+c['voucher']+'.pdf'
 c['upload_file']='bilag/'+c['voucher']+('.png' if c['key']=='E' else '.pdf')
 p=canvas.Canvas(str(out/c['file']),pagesize=A4,invariant=1)
 p.setFillColor(HexColor('#15354A'));p.rect(0,745,595,97,fill=1,stroke=0)
 p.setFillColor(HexColor('#FFFFFF'));p.setFont('DV',22);p.drawString(42,791,'SYNTETISK TESTBILAG')
 p.setFont('DV',11);p.drawString(42,768,c['voucher'])
 p.setFillColor(HexColor('#172B3A'));p.setFont('DV',16);p.drawString(42,704,c['title'])
 p.setFont('DV',11)
 for y,t in [(666,'Dato: '+c['date']),(643,'Leverandør: E2E Testleverandør (fiktiv)'),(620,'Modtager: Test Regnskab API'),(597,'Valuta: DKK | Test uden moms | Ingen virkelig handel')]:p.drawString(42,y,t)
 p.setFillColor(HexColor('#E9F0F5'));p.rect(42,540,511,30,fill=1,stroke=0)
 p.setFillColor(HexColor('#172B3A'));p.drawString(52,550,'Beskrivelse');p.drawRightString(543,550,'Beløb DKK')
 y=515
 for desc,amount in c['lines']:
  p.drawString(52,y,desc);p.drawRightString(543,y,f'{Decimal(amount):.2f}'.replace('.',','));y-=28
 p.line(42,y,553,y);p.setFont('DV',13);p.drawString(52,y-28,'I alt');p.drawRightString(543,y-28,('-' if c['key']=='F' else '')+c['amount'].replace('.',','))
 p.setFont('DV',10)
 note='Dette er en pladsholder, IKKE dokumentation for købet.' if c['key']=='G' else 'Kun til funktionstest. Må ikke bruges i et rigtigt regnskab.'
 p.drawString(42,173,note);p.drawString(42,150,'Alle navne, handler og beløb er syntetiske.')
 p.drawString(42,70,'Testbilag | '+batch);p.showPage();p.save()
subprocess.run(['pdftoppm','-scale-to','1000','-singlefile','-png',str(out/'bilag'/f'{batch}-E.pdf'),str(out/'bilag'/f'{batch}-E')],check=True)
bank=[]
for c in cases:
 if c['bank']:bank.append([c['date'],c['voucher'],('' if c['key']=='F' else '-')+c['amount'].replace('.',',')])
with (out/'BANK_IMPORT_E2E_20261030_01.csv').open('w',encoding='utf-8-sig',newline='') as f:
 w=csv.writer(f,delimiter=';');w.writerow(['Dato','Beskrivelse','Beløb']);w.writerows(bank)
# Facit is the incremental effect of this batch only, not the existing company balance.
manifest=dict(batch=batch,cases=cases,operations=ops,
 expected=dict(final_booked_accounts={'1815':'120.00','1810':'330.10','1880':'985.15','5710':'-1435.25'},
 bank_import_net='-1510.25',unresolved_bank_amount='-75.00',matched_bank_rows=6,unmatched_bank_rows=1,
 ready_bank_drafts=['A','B','C','D','E','F'],unbooked_missing=['G'],deleted=['J'],internal_transactions=4,
 bank_phase='Requires CSV import by user, then link drafts BEFORE booking and approval.'))
(out/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
(out/'LAES_MIG.txt').write_text('Stor samlet Billy-testpakke '+batch+'\n\nKun Test Regnskab API. DKK uden moms.\n\nBANKIMPORT: Importér BANK_IMPORT_E2E_20261030_01.csv én gang på offlinebank (5710).\nKolonner: Dato;Beskrivelse;Beløb. Negative beløb er udbetalinger. Positive er indbetalinger.\n7 linjer, nettoudbetaling 1.510,25 kr. Ingen import på et produktionsregnskab.\n\nFacit gælder KUN denne pakke, ikke regnskabets samlede saldo.\nA-F skal efter import tilknyttes kladder, bogføres og bankgodkendes.\nG skal forblive åben/ubogført pga. manglende rigtigt bilag.\nH er en intern ompostering med rettelse; I tilbageføres; J slettes som kladde.\n\nPDF G er en tydelig pladsholder, ikke et købsbilag.\nSe manifest og slutrapport for facit og faktisk status.\n',encoding='utf-8')
print(json.dumps({'batch':batch,'cases':len(cases),'pdfs':len(cases),'bank_rows':len(bank),'output':str(out)}))
