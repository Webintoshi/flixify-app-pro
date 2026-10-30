package vip.flixify.tv.update;

interface PackageChecks extends UpdateIo.Verifier {
    UpdatePolicy policy() throws UpdateFailure;
}
