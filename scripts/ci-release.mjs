// GitHub-side release coordination. Local release preparation never invokes it.
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export function compareVersions(a, b) {
  if (!versionPattern.test(a) || !versionPattern.test(b))
    throw new Error("Expected X.Y.Z versions.");
  const left = a.split(".").map(BigInt),
    right = b.split(".").map(BigInt);
  for (let i = 0; i < 3; i++)
    if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
  return 0;
}
export function releaseDecision({
  version,
  sha,
  tags,
  existingTag,
  published,
}) {
  if (!versionPattern.test(version))
    throw new Error("The source version must be X.Y.Z.");
  const tag = `v${version}`;
  if (published)
    return {
      release: false,
      tag,
      reason: `${tag} is already published. Increase the source version for a new release.`,
    };
  if (existingTag && existingTag !== sha)
    throw new Error(
      `${tag} belongs to a different commit. Do not move it; increase the source version.`,
    );
  const newer = tags
    .filter((t) => /^v\d+\.\d+\.\d+$/.test(t))
    .some((t) => compareVersions(t.slice(1), version) > 0);
  if (newer)
    throw new Error(
      `A newer version than ${tag} already exists. Downgrade publication refused.`,
    );
  return {
    release: true,
    tag,
    reason: existingTag
      ? `Retrying the unpublished ${tag} at its original commit.`
      : `New source version ${tag}; packages will be built before tagging and publication.`,
  };
}
const missing = (error) => error.status === 404;
export async function tagCommit(github, repo, tag) {
  let ref;
  try {
    ref = (await github.rest.git.getRef({ ...repo, ref: `tags/${tag}` })).data
      .object;
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
  for (let i = 0; i < 8; i++) {
    if (ref.type === "commit") return ref.sha;
    if (ref.type !== "tag") throw new Error(`Unexpected object for ${tag}.`);
    ref = (await github.rest.git.getTag({ ...repo, tag_sha: ref.sha })).data
      .object;
  }
  throw new Error(`Too many annotated tag indirections for ${tag}.`);
}
export async function selectRelease({ github, context, version, sha }) {
  const repo = context.repo;
  const branch = context.payload.repository.default_branch;
  if (context.eventName === "workflow_run") {
    const run = context.payload.workflow_run;
    if (
      run.conclusion !== "success" ||
      run.head_repository?.full_name !== `${repo.owner}/${repo.repo}` ||
      run.head_branch !== branch ||
      !["push", "workflow_dispatch"].includes(run.event) ||
      run.head_sha !== sha
    ) {
      throw new Error(
        "Release requires successful Checks for this exact commit on the default branch.",
      );
    }
  } else if (context.eventName === "workflow_dispatch") {
    if (context.ref !== `refs/heads/${branch}`)
      throw new Error(`Run Desktop packages from ${branch}.`);
    const runs = (
      await github.rest.actions.listWorkflowRuns({
        ...repo,
        workflow_id: "checks.yml",
        branch,
        head_sha: sha,
        per_page: 100,
      })
    ).data.workflow_runs.filter(
      (r) =>
        ["push", "workflow_dispatch"].includes(r.event) &&
        r.head_repository?.full_name === `${repo.owner}/${repo.repo}`,
    );
    if (runs[0]?.status !== "completed" || runs[0]?.conclusion !== "success")
      throw new Error(
        "Run Checks successfully for this commit first, then run Desktop packages.",
      );
  } else throw new Error("Unsupported release trigger.");
  const tag = `v${version}`;
  let published = false;
  try {
    published = !(await github.rest.repos.getReleaseByTag({ ...repo, tag }))
      .data.draft;
  } catch (error) {
    if (!missing(error)) throw error;
  }
  const tags = await github.paginate(github.rest.repos.listTags, {
    ...repo,
    per_page: 100,
  });
  return releaseDecision({
    version,
    sha,
    tags: tags.map((t) => t.name),
    existingTag: await tagCommit(github, repo, tag),
    published,
  });
}
export async function ensureReleaseTag({ github, repo, version, sha }) {
  const tag = `v${version}`;
  const existing = await tagCommit(github, repo, tag);
  if (existing) {
    if (existing !== sha)
      throw new Error(`${tag} changed after review. Publication refused.`);
    return;
  }
  const object = await github.rest.git.createTag({
    ...repo,
    tag,
    message: `DRC ${version}`,
    object: sha,
    type: "commit",
  });
  try {
    await github.rest.git.createRef({
      ...repo,
      ref: `refs/tags/${tag}`,
      sha: object.data.sha,
    });
  } catch (error) {
    if (error.status !== 422 || (await tagCommit(github, repo, tag)) !== sha)
      throw error;
  }
}
