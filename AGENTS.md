# Agent Instructions

## Docker Self-Replacement Safety

The running Sub2API container may also provide the model/provider connection used by the agent performing the deployment. Replacing that container can therefore interrupt the agent itself.

When replacing or restarting the running Sub2API container:

- Build and validate the new image before stopping the current container.
- Never issue the stop/remove operation and the replacement start operation as separate tool calls or separate shell commands.
- Run the complete cutover in one shell invocation: stop the old container, preserve or rename it for rollback, start the replacement with the existing environment, mounts, ports, and networks, then check its health.
- The same shell invocation must automatically restore and restart the previous container if the replacement fails to start, exits early, or does not become healthy within a bounded timeout.
- Keep the previous container/image until the replacement has passed both its container health check and an HTTP health check.

This requirement is mandatory even when a brief outage would otherwise be acceptable. Its purpose is to prevent an interrupted provider connection from leaving the deployment stopped with no agent available to recover it.
