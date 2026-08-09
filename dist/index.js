function deferred(command) {
    return { command, status: "not_implemented" };
}
export function validate() {
    return deferred("validate");
}
export function projectIndex() {
    return deferred("project-index");
}
export function contractDigest() {
    return deferred("contract-digest");
}
