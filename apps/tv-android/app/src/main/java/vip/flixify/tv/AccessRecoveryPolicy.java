package vip.flixify.tv;

public final class AccessRecoveryPolicy {
    private AccessRecoveryPolicy(){}
    public static boolean shouldResolve(TvModels.Failure.Code code,boolean session,String owner,String currentOwner,String requestedScope,String currentScope){
        if(!session||!owner.equals(currentOwner))return false;
        return code==TvModels.Failure.Code.INELIGIBLE||code==TvModels.Failure.Code.STALE&&!requestedScope.isEmpty()&&currentScope.isEmpty();
    }
}
