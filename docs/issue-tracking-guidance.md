# Issue tracking

All epics and stories live in GitHub issues in `YourTechBudStudio/Toph`. Use issue numbers and URLs as identifiers, and `gh` or `gh api` to manage them. No separate local issue copies, Projects, or milestones by default.

## Labels and relationships

| Issue | Required labels                                                            | Optional labels                               |
| ----- | -------------------------------------------------------------------------- | --------------------------------------------- |
| Epic  | `type: epic`                                                               | Either `epic: candidate` or `epic: committed` |
| Story | `type: story` and exactly one of `story: implementation` or `story: spike` | —                                             |

An epic without a commitment label is undecided. Stories contributing to an epic belong to it through GitHub's native parent/sub-issue relationship. Standalone stories are allowed when no meaningful larger epic is needed; do not create an epic solely to wrap one story. Use native blocked-by relationships for dependencies, including between standalone stories and epic-owned stories.

Create candidates only when explicitly requested. Record their possible outcome, value, deferral reason, and resumption context; give them no stories. After shaping and approval, replace `epic: candidate` with `epic: committed`.

## Issue contents

**Epics:** goal, value and rationale, scope and exclusions, completion condition, and consequential decisions or uncertainty.

**Stories:** outcome, contribution to the epic, observable acceptance checkboxes, and enough context, constraints, evidence, and rationale to resume independently. Implementation stories deliver vertical slices; defer dependent stories until uncertainty is resolved.

**Spikes:** also identify uncertainty, decisions enabled, and affected work. Acceptance requires findings, evidence, limitations, alternatives, and remaining questions, followed by user review and approved epic/story updates. Persist these before closing, including rationale for retaining existing scope.

## Maintaining and closing work

Before work, read the issue, parent, relevant comments, and dependencies. Keep bodies current through focused edits; preserve user context and material history in comments. When splitting, moving, replacing, or removing stories, explain why, link replacements, and update relationships.

- **Open:** unfinished, not necessarily implementation-ready.
- **Completed:** the outcome is fulfilled. An epic must meet its completion condition, not merely have all current stories closed.
- **Not planned:** abandoned or superseded; record the rationale and add the `wontfix` label.

Labels remain independent of open/closed state.

## Approval and verification

Present proposed writes and obtain explicit approval before publication or updates. An explicit request to save counts; agreement on direction or a request to close a spike alone does not. Verify writes and relationships before reporting success.
