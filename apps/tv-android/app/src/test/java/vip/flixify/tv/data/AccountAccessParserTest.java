package vip.flixify.tv.data;
import org.json.*;import org.junit.Test;import static org.junit.Assert.*;import vip.flixify.tv.TvModels.Account;
public class AccountAccessParserTest {
 private JSONObject user(boolean active,boolean assigned)throws Exception{return new JSONObject().put("hasActiveSubscription",active).put("hasAssignedLink",assigned).put("status","active");}
 @Test public void authoritativeReasonSurvivesTrialHistory()throws Exception{
  JSONObject u=user(false,false).put("trialProvisionStatus","pending");assertEquals(Account.Access.TRIAL_PENDING,AccountAccessParser.reason(u,1700000000000L));
  u.put("hasExpiredSubscription",true);assertEquals(Account.Access.EXPIRED,AccountAccessParser.reason(u,1700000000000L));
  u.put("status","blocked");assertEquals(Account.Access.BLOCKED,AccountAccessParser.reason(u,1700000000000L));
 }
 @Test public void activeAndProvisioningWinOverHistoricalTrial()throws Exception{
  JSONObject u=user(true,false).put("trialProvisionStatus","pending").put("activePackage",new JSONObject().put("endsAt","2030-01-01T00:00:00Z"));
  assertEquals(Account.Access.PROVISIONING,AccountAccessParser.reason(u,1700000000000L));u.put("hasAssignedLink",true);assertEquals(Account.Access.ACTIVE,AccountAccessParser.reason(u,1700000000000L));
 }
 @Test(expected=ProviderParser.Invalid.class)public void unknownTrialCannotInventExpiry()throws Exception{AccountAccessParser.reason(user(false,false).put("trialProvisionStatus","unknown"),1700000000000L);}
 @Test(expected=ProviderParser.Invalid.class)public void missingActiveDeadlineIsNotExpiry()throws Exception{AccountAccessParser.reason(user(true,true),1700000000000L);}
 @Test(expected=ProviderParser.Invalid.class)public void malformedActiveDeadlineIsNotExpiry()throws Exception{AccountAccessParser.reason(user(true,true).put("activePackage",new JSONObject().put("endsAt","bad")),1700000000000L);}
 @Test(expected=ProviderParser.Invalid.class)public void malformedInactivePackageIsNotConfirmedExpiry()throws Exception{AccountAccessParser.reason(user(false,false).put("activePackage",new JSONObject().put("endsAt","bad")),1700000000000L);}

 @Test public void newNoPlanAccountCanChoosePackages()throws Exception{assertEquals(Account.Access.EXPIRED,AccountAccessParser.reason(user(false,false).put("status","new"),1700000000000L));}

}
