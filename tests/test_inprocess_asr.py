"""Exercise secure in-process local-only model caching with a fake ASR engine.

Tests validate the actual production Python adapter and FastAPI token/PCM
routing; they do not claim real multilingual model inference.
"""
import io
import os
import tempfile
import unittest
import wave
from pathlib import Path
from unittest.mock import patch
from fastapi.testclient import TestClient

os.environ.setdefault("PIT_BRIDGE_TOKEN","test-local-secret-at-least-16")
os.environ.setdefault("DEEPSEEK_API_KEY","fake-test-key-never-use")
from services import faster_whisper_backend as fast
from services import babeldoc_bridge as bridge

def pcm_audio(rate=16000):
    buffer=io.BytesIO()
    with wave.open(buffer,"wb") as stream:
        stream.setframerate(rate)
        stream.setsampwidth(2)
        stream.setnchannels(1)
        stream.writeframes(b"\x00\x00"*rate)
    return buffer.getvalue()


class FakeSegment:
    text="SPEECH FROM OWNED OFFLINE MODEL"
class FakeWhisperModel:
    init_count=0
    inference_count=0
    def __init__(self,path,**kwargs):
        FakeWhisperModel.init_count+=1
        assert kwargs["local_files_only"] is True
        assert kwargs["device"]=="cpu"
        assert kwargs["compute_type"]=="int8"
        assert Path(path).is_dir()
    def transcribe(self,samples,**kwargs):
        FakeWhisperModel.inference_count+=1
        assert kwargs["language"] is None
        assert kwargs["condition_on_previous_text"] is False
        assert 1000<=len(samples)<=16000
        return iter([FakeSegment()]),{}


class UpstreamApiContract(unittest.TestCase):
    def test_actual_faster_whisper_installation_exposes_required_local_api(self):
        import inspect
        from faster_whisper import WhisperModel
        arguments=inspect.signature(WhisperModel).parameters
        self.assertIn("local_files_only",arguments)
        self.assertIn("device",arguments)
        self.assertIn("compute_type",arguments)
        infer=inspect.signature(WhisperModel.transcribe).parameters
        for name in ("beam_size","condition_on_previous_text","without_timestamps","vad_filter"):
            self.assertIn(name,infer)


class LocalModelTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path=Path(self.temp.name)
        for name in ("model.bin","config.json","tokenizer.json"):
            (self.path/name).write_bytes(b"synthetic fixture")
        self.patch=patch.dict(os.environ,{"PIT_FASTER_WHISPER_MODEL_DIR":str(self.path)})
        self.patch.start()
        self.addCleanup(self.patch.stop)
        fast._model=None
        fast._model_path=None
        FakeWhisperModel.init_count=0
        FakeWhisperModel.inference_count=0

    def test_strict_local_model_directory_blocks_names_and_missing_assets(self):
        self.assertEqual(fast.model_directory(),self.path)
        with self.assertRaises(ValueError):
            fast.model_directory("base")
        (self.path/"tokenizer.json").unlink()
        with self.assertRaises(ValueError):
            fast.model_directory()
        self.assertFalse(fast.model_available())

    def test_real_wav_decode_model_cache_and_no_network_loading(self):
        text1=fast.transcribe_local(pcm_audio(),factory=FakeWhisperModel)
        text2=fast.transcribe_local(pcm_audio(),factory=FakeWhisperModel)
        self.assertEqual(text1,text2)
        self.assertEqual(FakeWhisperModel.init_count,1)
        self.assertEqual(FakeWhisperModel.inference_count,2)
        self.assertTrue(fast.model_loaded())
        self.assertEqual(text1,"SPEECH FROM OWNED OFFLINE MODEL")

    def test_faster_whisper_language_probability_forwarded_only_if_reported(self):
        class FakeInfo:
            language="fr"
            language_probability=.87
        class Multilingual(FakeWhisperModel):
            def transcribe(self,samples,**kwargs):
                return iter([FakeSegment()]),FakeInfo()
        result=fast.transcribe_local(pcm_audio(),factory=Multilingual,
                                    return_metadata=True)
        self.assertEqual(result["language"],"fr")
        self.assertAlmostEqual(result["languageConfidence"],.87)
        self.assertEqual(len(result["segments"]),1)

    def test_wrong_samplerate_and_duration_fail_closed(self):
        with self.assertRaises(ValueError):
            fast.transcribe_local(pcm_audio(48000),factory=FakeWhisperModel)

    def test_bridge_authentication_and_in_process_forwarding(self):
        client=TestClient(bridge.app)
        headers={"X-PIT-Token":"test-local-secret-at-least-16"}
        with patch.object(bridge,"ASR_BACKEND","faster"),\
             patch.object(bridge,"model_available",return_value=True),\
             patch.object(bridge,"transcribe_local",side_effect=lambda data,**options:
                          fast.transcribe_local(data,factory=FakeWhisperModel,**options)):
            rejected=client.post("/asr",
                files={"audio":("clip.wav",pcm_audio(),"audio/wav")})
            accepted=client.post("/asr",headers=headers,
                files={"audio":("clip.wav",pcm_audio(),"audio/wav")})
            health=client.get("/health",headers=headers)
        self.assertEqual(rejected.status_code,401)
        self.assertEqual(accepted.status_code,200,accepted.text)
        self.assertEqual(accepted.json()["text"],"SPEECH FROM OWNED OFFLINE MODEL")
        self.assertEqual(accepted.json()["segments"][0]["text"],"SPEECH FROM OWNED OFFLINE MODEL")
        self.assertEqual(health.status_code,200)
        self.assertEqual(health.json()["speech_asr_backend"],"faster")
        self.assertTrue(health.json()["speech_asr_model_loaded"])


if __name__=="__main__":
    unittest.main()
