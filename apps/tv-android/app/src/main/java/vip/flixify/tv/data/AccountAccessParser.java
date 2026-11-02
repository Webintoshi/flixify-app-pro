package vip.flixify.tv.data;

import org.json.JSONObject;
import vip.flixify.tv.TvModels.Account;

public final class AccountAccessParser {
    private AccountAccessParser(){}
    public static Account.Access reason(JSONObject user,long now)throws Exception{
        if(!(user.opt("hasAssignedLink") instanceof Boolean)||!(user.opt("hasActiveSubscription") instanceof Boolean))throw new ProviderParser.Invalid();
        String status=user.optString("status","");if(!"active".equals(status)&&!"new".equals(status)&&!"blocked".equals(status))throw new ProviderParser.Invalid();
        if("blocked".equals(user.optString("status")))return Account.Access.BLOCKED;
        JSONObject pkg=user.optJSONObject("activePackage");long deadline=pkg==null?0:ProviderParser.date(pkg.opt("endsAt"));
        if(pkg!=null&&deadline<=0)throw new ProviderParser.Invalid();
        if(user.optBoolean("hasActiveSubscription")){
            if(deadline<=0)throw new ProviderParser.Invalid();
            if(deadline>now)return user.optBoolean("hasAssignedLink")?Account.Access.ACTIVE:Account.Access.PROVISIONING;
            return Account.Access.EXPIRED;
        }
        if(user.optBoolean("hasExpiredSubscription")||deadline>0&&deadline<=now)return Account.Access.EXPIRED;
        String trial=user.optString("trialProvisionStatus","");
        if("pending".equals(trial)||"review".equals(trial))return Account.Access.TRIAL_PENDING;
        if(!trial.isEmpty()&&!"null".equals(trial))throw new ProviderParser.Invalid();
        return Account.Access.EXPIRED;
    }
}
