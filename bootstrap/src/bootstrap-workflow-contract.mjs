// Distribution owns consumer projection shape; this contains no runtime logic.
export function workflowProjectionErrors(bundle, quality, architecture) {
  const errors = [];
  const qualityFields = quality.match(/^jobs:\n  control-plane-contract:\n    uses: agentic-delivery-lab\/agentic-delivery\/\.github\/workflows\/agentic-delivery-quality\.yml@([0-9a-f]{40})\n    with:\n      controller_commit: ([0-9a-f]{40})\n/m);
  if (qualityFields && (qualityFields[1] !== bundle.workflowSource?.commit
    || qualityFields[2] !== bundle.controlPlane?.commit)) {
    errors.push('consumer workflow must separate workflow source and Control Plane pins');
  }
  if (!qualityFields) {
    errors.push('consumer quality workflow must be structurally valid reusable-workflow YAML');
  }
  const architectureFields = architecture.match(/^jobs:\n  architecture:\n    uses: agentic-delivery-lab\/agentic-delivery\/\.github\/workflows\/agentic-delivery-architecture-review\.yml@([0-9a-f]{40})\n    with:\n      architecture_commit: ([0-9a-f]{40})\n      affected_identifiers: '([^']+)'\n/m);
  if (architectureFields && (architectureFields[1] !== bundle.workflowSource?.commit
    || architectureFields[2] !== bundle.architecture?.commit
    || architectureFields[3] !== JSON.stringify(bundle.architecture?.affectedIdentifiers))) {
    errors.push('architecture review workflow must pin workflow source, Architecture, and affected identifiers separately');
  }
  if (!architectureFields) {
    errors.push('architecture review workflow must be structurally valid reusable-workflow YAML');
  }
  return errors;
}
