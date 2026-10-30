"""Generate the synthetic PNG document used in the live test protocol."""
from PIL import Image, ImageDraw
from pathlib import Path
im=Image.new('RGB',(640,260),'white')
d=ImageDraw.Draw(im)
for y,line in enumerate(['TESTDATA - IKKE ET RIGTIGT BILAG','TESTPAKKE-02 / 2026-10-20','Linje 1: DKK 0,10','Linje 2: DKK 0,20','I alt: DKK 0,30','Kun teknisk test - ingen betaling']):
 d.text((24,24+y*34),line,fill='black')
im.save(Path(__file__).with_name('test-receipt.png'))
