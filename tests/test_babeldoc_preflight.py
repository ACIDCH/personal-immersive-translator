"""BabelDOC upstream CLI compatibility checks require no paid API keys."""
import subprocess
import os
os.environ.setdefault('PIT_BRIDGE_TOKEN','test-local-secret-at-least-16')
os.environ.setdefault('DEEPSEEK_API_KEY','fake-test-key-never-use')
import unittest
from unittest.mock import patch
from services.babeldoc_preflight import FLAGS,inspect_babeldoc_cli
from services import babeldoc_bridge as bridge


class BabeldocCliCompatibilityTest(unittest.TestCase):
    def test_current_upstream_features_recognized_without_credentials(self):
        flags="\n".join(FLAGS)
        def fake_run(argv,**kwargs):
            self.assertEqual(argv,["/usr/bin/babeldoc","--help"])
            self.assertNotIn("api-key-here",str(argv))
            self.assertLessEqual(kwargs["timeout"],12)
            return subprocess.CompletedProcess(argv,0,stdout=flags,stderr="")
        with patch("services.babeldoc_preflight.subprocess.run",
                   side_effect=fake_run) as runner:
            result=inspect_babeldoc_cli("/usr/bin/babeldoc")
        self.assertTrue(result["compatible"],result)
        runner.assert_called_once()

    def test_missing_critical_flag_is_incompatible(self):
        good=" ".join(flag for flag in FLAGS if flag!="--config")
        with patch("services.babeldoc_preflight.subprocess.run",
                   return_value=subprocess.CompletedProcess(["babeldoc","--help"],
                                                             0,stdout=good,stderr="")):
            result=inspect_babeldoc_cli("/usr/bin/babeldoc")
        self.assertFalse(result["compatible"])
        self.assertIn("--config",result["missing"])

    def test_timeout_or_binary_missing_fails_closed(self):
        with patch("services.babeldoc_preflight.shutil.which",return_value=None):
            self.assertEqual(inspect_babeldoc_cli()["installed"],False)
        with patch("services.babeldoc_preflight.subprocess.run",
                   side_effect=subprocess.TimeoutExpired(["babeldoc"],12)):
            result=inspect_babeldoc_cli("/usr/bin/babeldoc")
        self.assertFalse(result["compatible"])

    def test_local_health_never_mislabels_incompatible_binary_as_ready(self):
        from fastapi.testclient import TestClient
        with patch.object(bridge,"inspect_babeldoc_cli",
                          return_value={"installed":True,"compatible":False,
                                        "missing":["--config"]}):
            health=TestClient(bridge.app).get("/health",headers={
                "X-PIT-Token":"test-local-secret-at-least-16"})
        self.assertEqual(health.status_code,200)
        self.assertFalse(health.json()["ready"])
        self.assertIn("--config",health.json()["babeldoc_cli"]["missing"])


if __name__=="__main__":
    unittest.main()
