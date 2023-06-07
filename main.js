import * as core from "@actions/core";
import * as github from "@actions/github";
import {
  Package,
  Snapshot,
  Manifest,
  submitSnapshot,
} from "@github/dependency-submission-toolkit";

async function run() {
  const snapshot = new Snapshot(
    {
      name: "purls-submission-action",
      version: "0.0.1",
      url: "https://github.com/hmaurer/purls-submission-action",
    },
    github.context,
    {
      correlator: github.context.job,
      id: github.context.runId.toString(),
    }
  );

  const purls = core.getInput("purls").split("\n");
  const manifest = new Manifest("purls", "purls");
  purls.forEach((purl) => manifest.addDirectDependency(new Package(purl)));
  snapshot.addManifest(manifest);
  submitSnapshot(snapshot);
}

run();
