#!/usr/bin/env bash
# Uploads a packaged extension to the Chrome Web Store (API v2) and submits it for review.
#
# Required environment:
#   CWS_CLIENT_ID, CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN  OAuth client with the
#       https://www.googleapis.com/auth/chromewebstore scope
#   CWS_PUBLISHER_ID  Publisher ID from the Developer Dashboard account page
#   CWS_EXTENSION_ID  Item ID of the existing store listing
# Optional:
#   CWS_PUBLISH=false  Upload only; submit for review manually in the dashboard
#
# Usage: scripts/cws-publish.sh release/audiorack-1.2.3.zip
set -euo pipefail

archive="${1:?usage: cws-publish.sh <extension.zip>}"
for name in CWS_CLIENT_ID CWS_CLIENT_SECRET CWS_REFRESH_TOKEN CWS_PUBLISHER_ID \
    CWS_EXTENSION_ID; do
    if [[ -z "${!name:-}" ]]; then
        echo "::error::$name is not set" >&2
        exit 1
    fi
done

api="https://chromewebstore.googleapis.com"
item="publishers/${CWS_PUBLISHER_ID}/items/${CWS_EXTENSION_ID}"

token="$(
    curl --fail-with-body --silent --show-error https://oauth2.googleapis.com/token \
        --data-urlencode "client_id=${CWS_CLIENT_ID}" \
        --data-urlencode "client_secret=${CWS_CLIENT_SECRET}" \
        --data-urlencode "refresh_token=${CWS_REFRESH_TOKEN}" \
        --data-urlencode "grant_type=refresh_token" \
        | jq -r '.access_token'
)"
if [[ -z "$token" || "$token" == "null" ]]; then
    echo "::error::Could not obtain an access token" >&2
    exit 1
fi
echo "::add-mask::$token"
auth=(-H "Authorization: Bearer ${token}")

upload_state() {
    jq -r '.uploadState // .lastAsyncUploadState // "UNKNOWN"'
}

echo "Uploading $archive"
response="$(
    curl --fail-with-body --silent --show-error -X POST "${auth[@]}" \
        -H "Content-Type: application/zip" \
        --data-binary "@${archive}" \
        "${api}/upload/v2/${item}:upload"
)"
echo "$response" | jq .
state="$(echo "$response" | upload_state)"

for _ in $(seq 1 30); do
    [[ "$state" == "IN_PROGRESS" ]] || break
    sleep 10
    response="$(
        curl --fail-with-body --silent --show-error "${auth[@]}" "${api}/v2/${item}:fetchStatus"
    )"
    state="$(echo "$response" | upload_state)"
    echo "Upload state: $state"
done

if [[ "$state" != "SUCCEEDED" ]]; then
    echo "::error::Upload did not succeed (state: $state)" >&2
    echo "$response" | jq . >&2
    exit 1
fi

if [[ "${CWS_PUBLISH:-true}" != "true" ]]; then
    echo "Uploaded; publishing skipped (CWS_PUBLISH=${CWS_PUBLISH})."
    exit 0
fi

echo "Submitting for review"
curl --fail-with-body --silent --show-error -X POST "${auth[@]}" \
    -H "Content-Length: 0" \
    "${api}/v2/${item}:publish" | jq .
