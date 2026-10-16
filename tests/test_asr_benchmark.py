import importlib.util
import tempfile
import unittest
import wave
from pathlib import Path

source=Path(__file__).resolve().parents[1]/"benchmarks"/"whisper_real_device.py"
spec=importlib.util.spec_from_file_location("pit_whisper_bench",source)
bench=importlib.util.module_from_spec(spec)
spec.loader.exec_module(bench)

class WhisperBenchmarkContract(unittest.TestCase):
    def test_actual_sample_rate_validation(self):
        with tempfile.TemporaryDirectory() as temp:
            sample=Path(temp)/"short.wav"
            for rate in [16000,48000]:
                with wave.open(str(sample),"wb") as stream:
                    stream.setframerate(rate)
                    stream.setnchannels(1)
                    stream.setsampwidth(2)
                    stream.writeframes(b"\0\0"*rate)
                if rate==16000:
                    self.assertEqual(bench.wav_duration(sample),1.0)
                else:
                    with self.assertRaises(ValueError):
                        bench.wav_duration(sample)

    def test_summary_has_realistic_quantiles_and_no_transcription(self):
        result=bench.summarize([1.0,2.0,15.0],2,3)
        self.assertEqual(result["runs"],3)
        self.assertEqual(result["failures"],2)
        self.assertEqual(result["p50_ms"],2000)
        self.assertEqual(result["p95_ms"],15000)
        self.assertEqual(result["dropped_over_12s"],1)
        self.assertNotIn("transcript",result)

if __name__=="__main__":
    unittest.main()
