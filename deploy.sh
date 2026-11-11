#!/usr/bin/env bash
# Deploys Tota Reads to Cloud Run, with the Gemini key kept in Secret Manager.
#
# Usage:
#   PROJECT_ID=my-project ./deploy.sh
# Optional: REGION (default asia-south1, Mumbai), SERVICE, SECRET, GEMINI_API_KEY.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || true)}"
REGION="${REGION:-asia-south1}"
SERVICE="${SERVICE:-tota-reads}"
SECRET="${SECRET:-gemini-api-key}"

if [[ -z "${PROJECT_ID}" ]]; then
  echo "Set your Google Cloud project first, for example:  PROJECT_ID=my-project ./deploy.sh" >&2
  exit 1
fi

echo "Project: ${PROJECT_ID}   Region: ${REGION}   Service: ${SERVICE}"

echo "1/4 Turning on the Google Cloud services this app needs…"
gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com secretmanager.googleapis.com --project "${PROJECT_ID}"

echo "2/4 Storing the Gemini key in Secret Manager…"
if gcloud secrets describe "${SECRET}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
  echo "    Secret '${SECRET}' already exists; keeping it."
else
  if [[ -z "${GEMINI_API_KEY:-}" ]]; then
    read -rsp "    Paste your Gemini API key (from aistudio.google.com/apikey): " GEMINI_API_KEY
    echo
  fi
  printf '%s' "${GEMINI_API_KEY}" | gcloud secrets create "${SECRET}" \
    --data-file=- --replication-policy=automatic --project "${PROJECT_ID}"
fi

echo "3/4 Letting the app read the secret…"
PROJECT_NUMBER="$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')"
RUNTIME_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
gcloud secrets add-iam-policy-binding "${SECRET}" \
  --member "serviceAccount:${RUNTIME_SA}" --role roles/secretmanager.secretAccessor \
  --project "${PROJECT_ID}" >/dev/null

echo "4/4 Building and deploying to Cloud Run (takes 2–4 minutes)…"
gcloud run deploy "${SERVICE}" \
  --source . \
  --region "${REGION}" \
  --project "${PROJECT_ID}" \
  --allow-unauthenticated \
  --set-secrets "GEMINI_API_KEY=${SECRET}:latest" \
  --memory 512Mi \
  --timeout 60 \
  --max-instances 3

URL="$(gcloud run services describe "${SERVICE}" --region "${REGION}" --project "${PROJECT_ID}" --format='value(status.url)')"
echo
echo "Done. Open this on your phone: ${URL}"
