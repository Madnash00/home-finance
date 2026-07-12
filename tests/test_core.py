import tempfile, unittest
import app

class CoreTests(unittest.TestCase):
 def test_normalization(self): self.assertEqual(app.norm('  Caffè  Roma '),'CAFFE ROMA')
 def test_fingerprint_is_deterministic(self): self.assertEqual(app.fp('ISP','2026-01-01',-10,'A'),app.fp('isp','2026-01-01',-10,' a '))
 def test_fingerprint_distinguishes_channel(self): self.assertNotEqual(app.fp('ISP','2026-01-01',-10,'A',channel='POS'),app.fp('ISP','2026-01-01',-10,'A',channel='WEB'))
 def test_excel_dates(self): self.assertEqual(app.xl_date(46023),'2026-01-01')
 def test_sign_convention(self):
  credit,debit=20,None; amount=abs(credit) if credit else -abs(debit); self.assertGreater(amount,0)
  credit,debit=None,-20; amount=abs(credit) if credit else -abs(debit); self.assertLess(amount,0)

if __name__=='__main__': unittest.main()
