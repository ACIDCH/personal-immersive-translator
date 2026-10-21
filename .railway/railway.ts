/**
 * PIT's Railway deployment plan. Apply only to a dedicated preview project
 * after verifying the Railway project/service name, spend and GitHub access.
 *
 * This file does NOT deploy, create a charged resource, or set secret values.
 * PDF/BabelDOC stays an independent container, not part of Chrome MV3.
 *
 * Railway IAC: https://docs.railway.com/infrastructure-as-code/reference
 */
import {defineRailway, github, preserve, project, service} from "railway/iac";

export default defineRailway(() => {
  const pdf = service("pit-babeldoc-preview", {
    source: github("ACIDCH/personal-immersive-translator", {
      branch: "feat/chrome-native-no-key-translation-20261018"
      // Keep repository ROOT as Docker build context: Dockerfile COPY services.
    }),
    // Startup liveness is unprivileged. Engine capability readiness stays
    // separately Bearer-authenticated on /health; never expose its details.
    healthcheck: "/livez",
    healthcheckTimeout: 300,
    replicas: 1,
    env: {
      RAILWAY_DOCKERFILE_PATH: "services/cloud-pdf/Dockerfile",
      PIT_CLOUD_PDF_TOKEN: preserve(),
      PIT_PDF_API_KEY: preserve(),
      PIT_PDF_BASE_URL: preserve(),
      PIT_PDF_MODEL: preserve()
    }
  });

  return project("pit-translation-services", {resources: [pdf]});
});
