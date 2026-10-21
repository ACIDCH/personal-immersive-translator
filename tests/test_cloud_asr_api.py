"""Cloud ASR API contract. Actual model CPU inference is tested separately."""
import io
import os
import unittest
import wave
from unittest.mock import patch
from fastapi.testclient import TestClient
from services import cloud_asr_api as cloud

TOKEN="test-pit-asr-secret-at-least-16"

def example_wav(frames=16000):
    file=io.BytesIO()
    with wave.open(file,"wb") as s:
        s.setframerate(16000)
        s.setnchannels(1)
        s.setsampwidth(2)
        s.writeframes(b"\x00\x00"*frames)
    return file.getvalue()

class CloudASRTests(unittest.TestCase):
    def setUp(self):
        env=patch.dict(os.environ,{"PIT_CLOUD_ASR_TOKEN":TOKEN})
        env.start()
        self.addCleanup(env.stop)
        self.client=TestClient(cloud.app)
        self.headers={"Authorization":"Bearer "+TOKEN}

    def test_health_does_not_expose_model_and_private_status_is_protected(self):
        self.assertEqual(self.client.get("/livez").json(),{"status":"alive"})
        self.assertEqual(self.client.get("/v1/capabilities").status_code,401)
        self.assertEqual(self.client.post("/v1/asr",content=example_wav(),
            headers={"Content-Type":"audio/wav"}).status_code,401)
        with patch.object(cloud,"model_available",return_value=True),\
             patch.object(cloud,"model_loaded",return_value=False):
            result=self.client.get("/v1/capabilities",headers=self.headers)
        self.assertEqual(result.json()["routes"]["asr"],"ready")
        self.assertFalse(result.json()["model_loaded"])
        self.assertNotIn(TOKEN,result.text)

    def test_real_wav_input_routes_to_existing_inference_and_returns_language(self):
        transcript={"text":"Bonjour à tous.","segments":[{"text":"Bonjour à tous.",
            "start":0,"end":1.1}],"language":"fr","languageConfidence":.87}
        with patch.object(cloud,"model_available",return_value=True),\
             patch.object(cloud,"transcribe_local",return_value=transcript) as engine:
            actual=self.client.post("/v1/asr",headers={
                **self.headers,"Content-Type":"audio/wav"
            },content=example_wav())
        self.assertEqual(actual.status_code,200,actual.text)
        self.assertEqual(actual.json(),transcript)
        self.assertEqual(engine.call_args.kwargs,{"return_metadata":True})
        self.assertEqual(len(engine.call_args.args[0]),len(example_wav()))

    def test_rejects_invalid_media_unsupported_engine_and_overlong_audio(self):
        with patch.object(cloud,"model_available",return_value=True),\
             patch.object(cloud,"transcribe_local") as engine:
            unsupported=self.client.post("/v1/asr",headers={
                **self.headers,"Content-Type":"text/plain"
            },content=example_wav())
            bad=self.client.post("/v1/asr",headers={
                **self.headers,"Content-Type":"audio/wav"
            },content=b"junk")
            large=self.client.post("/v1/asr",headers={
                **self.headers,"Content-Type":"audio/wav"
            },content=example_wav(16000*13))
            self.assertEqual(unsupported.status_code,415)
            self.assertEqual(bad.status_code,400)
            self.assertEqual(large.status_code,413)
            engine.assert_not_called()
        with patch.object(cloud,"model_available",return_value=False):
            missing=self.client.post("/v1/asr",headers={
                **self.headers,"Content-Type":"audio/wav"
            },content=example_wav())
            self.assertEqual(missing.status_code,503)
