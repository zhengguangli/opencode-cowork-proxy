#!/usr/bin/env bash
set -euo pipefail

VERSION=$(node -p "require('./package.json').version")
TAP_REPO_PATH="/usr/local/Homebrew/Library/Taps/lizhengguang/homebrew-tap"
FORMULA_FILE="$TAP_REPO_PATH/Formula/opencode-cowork-proxy.rb"
DIST_FILE="./dist/opencode-cowork-proxy"
RELEASE_URL="https://github.com/zhengguangli/opencode-cowork-proxy/releases/download/v${VERSION}/opencode-cowork-proxy"

if [ ! -f "$DIST_FILE" ]; then
  echo "Error: $DIST_FILE not found. Run 'bun run build:binary' first."
  exit 1
fi

SHA256=$(shasum -a 256 "$DIST_FILE" | awk '{print $1}')

cat > "$FORMULA_FILE" <<FORMULA
class OpencodeCoworkProxy < Formula
  desc "API translation proxy for AI clients (Anthropic↔OpenAI)"
  homepage "https://github.com/zhengguangli/opencode-cowork-proxy"
  version "${VERSION}"
  url "${RELEASE_URL}"
  sha256 "${SHA256}"

  def install
    bin.install "opencode-cowork-proxy"
  end

  def post_install
    plist = "#{ENV["HOME"]}/Library/LaunchAgents/homebrew.mxcl.opencode-cowork-proxy.plist"
    if File.exist?(plist)
      quiet_system "launchctl", "bootout", "gui/#{Process.uid}", plist rescue nil
      quiet_system "launchctl", "bootstrap", "gui/#{Process.uid}", plist
    end
  end

  service do
    run [opt_bin/"opencode-cowork-proxy"]
    environment_variables PORT: "18787", VERSION: "${VERSION}"
    keep_alive true
    run_at_load true
    working_dir HOMEBREW_PREFIX
    log_path HOMEBREW_PREFIX/"var/log/opencode-cowork-proxy.log"
    error_log_path HOMEBREW_PREFIX/"var/log/opencode-cowork-proxy-error.log"
  end

  test do
    assert_predicate bin/"opencode-cowork-proxy", :executable?
  end
end
FORMULA

echo "Updated $FORMULA_FILE to version $VERSION"
echo "SHA256: $SHA256"
echo "Release URL: $RELEASE_URL"
