package vip.flixify.tv;

import android.app.AlertDialog;
import android.content.Context;
import android.content.Intent;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.telephony.PhoneNumberUtils;
import android.text.Editable;
import android.text.InputFilter;
import android.text.InputType;
import android.text.TextWatcher;
import android.view.Gravity;
import android.view.View;
import android.view.inputmethod.EditorInfo;
import android.widget.*;
import java.util.ArrayList;
import java.util.Locale;
import vip.flixify.tv.data.PhoneAuthGateway;
import vip.flixify.tv.TvModels.Failure;

public final class PhoneAuthScreen extends LinearLayout {
    private static final int BG=0xff07090c,PANEL=0xff13171e,TEXT=0xfff5f6f8,MUTED=0xffa7b0be,RED=0xffff3545,LINE=0xff343a44;
    private enum Mode { PHONE,CODE,OTP }
    private final PhoneAuthGateway gateway;private final Runnable authenticated;
    private PhoneAuthGateway.Recovery recovery=PhoneAuthGateway.Recovery.NONE;
    private Mode mode=Mode.PHONE;private boolean register,binding,busy,checking,phoneEnabled,completed,detached;
    private String phoneValue="",accountValue="",existingValue="",otpValue="",masked="",error="";private int epoch;
    private PhoneCountries.Country country=PhoneCountries.find("TR");private AlertDialog countryDialog;
    private EditText phoneInput,accountInput,existingInput,otpInput;private TextView expiry;private Button resend,verifySubmit;
    private final Runnable ticker=new Runnable(){public void run(){if(detached||mode!=Mode.OTP)return;updateClock();if(gateway.remainingSeconds()>0||gateway.resendSeconds()>0)postDelayed(this,1000);}};
    public PhoneAuthScreen(Context context,PhoneAuthGateway gateway,Runnable onAuthenticated){super(context);this.gateway=gateway;authenticated=onAuthenticated;setOrientation(VERTICAL);setGravity(Gravity.CENTER_HORIZONTAL);setPadding(dp(24),dp(34),dp(24),dp(24));setBackgroundColor(BG);checkStatus();}

    private void checkStatus(){checking=true;busy=false;error="";render();final int ticket=++epoch;
        gateway.status(new TvRepository.Callback<Boolean>(){
            public void onResult(Boolean enabled){if(!current(ticket))return;capture();checking=false;phoneEnabled=Boolean.TRUE.equals(enabled);if(!phoneEnabled||!accountValue.trim().isEmpty())mode=Mode.CODE;render();}
            public void onError(Failure failure){if(!current(ticket))return;capture();checking=false;phoneEnabled=false;mode=Mode.CODE;render();}
        });
    }
    private boolean current(int ticket){return !detached&&!completed&&ticket==epoch;}
    private void capture(){if(phoneInput!=null)phoneValue=phoneInput.getText().toString();if(accountInput!=null)accountValue=accountInput.getText().toString();if(existingInput!=null)existingValue=existingInput.getText().toString();if(otpInput!=null)otpValue=otpInput.getText().toString();}
    private void change(Mode next,boolean create){change(next,create,false);}
    private void change(Mode next,boolean create,boolean bind){capture();epoch++;gateway.cancelPending();mode=next;register=create;binding=bind;recovery=PhoneAuthGateway.Recovery.NONE;busy=false;error="";otpValue="";masked="";accountValue="";existingValue="";removeCallbacks(ticker);if(next==Mode.PHONE&&!phoneEnabled){checkStatus();return;}render();}
    private void render(){
        removeCallbacks(ticker);removeAllViews();phoneInput=null;accountInput=null;existingInput=null;otpInput=null;expiry=null;resend=null;verifySubmit=null;
        ImageView logo=new ImageView(getContext());logo.setImageResource(R.drawable.flixify_logo);logo.setContentDescription("Flixify Pro");logo.setScaleType(ImageView.ScaleType.FIT_CENTER);addView(logo,space(180,48,0));
        LinearLayout tabs=new LinearLayout(getContext());tabs.setGravity(Gravity.CENTER);addView(tabs,space(-1,48,28));
        tabs.addView(link("Giriş yap",()->change(phoneEnabled?Mode.PHONE:Mode.CODE,false)),new LayoutParams(0,-1,1));
        tabs.addView(link("Hesap oluştur",()->{if(phoneEnabled)change(Mode.PHONE,true);else website();}),new LayoutParams(0,-1,1));
        if(recovery!=PhoneAuthGateway.Recovery.NONE){
            addView(text("Kodun doğrulandı",24,TEXT,true),space(-1,-2,24));showError();
            if(recovery==PhoneAuthGateway.Recovery.REGISTRATION_REQUIRED)addView(primary("Hesap oluştur",()->change(Mode.PHONE,true)),space(-1,54,20));
            if(recovery!=PhoneAuthGateway.Recovery.ACCOUNT_CONFLICT)addView(link("Mevcut hesabımı bağla",()->change(Mode.PHONE,true,true)),space(-1,48,8));
            addView(link("Kullanıcı koduyla giriş",()->change(Mode.CODE,false)),space(-1,48,8));
            addView(link("Telefon numarasını değiştir",()->change(Mode.PHONE,false)),space(-1,48,0));return;
        }
        if(mode==Mode.OTP){
            addView(text("Telefonunu doğrula",24,TEXT,true),space(-1,-2,24));addView(text(masked,13,MUTED,false),space(-1,-2,8));
            otpInput=input("Doğrulama kodu",InputType.TYPE_CLASS_NUMBER,otpValue,6);otpInput.setImeOptions(EditorInfo.IME_ACTION_DONE);otpInput.setOnEditorActionListener((v,id,event)->{if(id==EditorInfo.IME_ACTION_DONE){verify();return true;}return false;});
            addView(otpInput,space(-1,54,20));expiry=text("",12,MUTED,false);addView(expiry,space(-1,-2,10));
            showError();verifySubmit=primary(busy?"Doğrulanıyor…":"Doğrula ve devam et",this::verify);verifySubmit.setEnabled(!busy&&gateway.remainingSeconds()>0);addView(verifySubmit,space(-1,54,20));
            resend=link("",this::sendPhone);resend.setEnabled(!busy&&gateway.resendSeconds()==0);addView(resend,space(-1,44,6));addView(link("Numarayı değiştir",()->change(Mode.PHONE,register)),space(-1,44,0));
            updateClock();postDelayed(ticker,1000);if(!busy)otpInput.requestFocus();return;
        }
        if(register&&phoneEnabled)addView(text("Hesap oluştur",24,TEXT,true),space(-1,-2,22));
        if(mode==Mode.PHONE&&phoneEnabled){
            LinearLayout row=new LinearLayout(getContext());row.setGravity(Gravity.CENTER_VERTICAL);row.setBackground(field());row.setPadding(dp(10),0,dp(10),0);addView(row,space(-1,56,24));
            Button countries=link(country.flag+" +"+country.callingCode,this::chooseCountry);countries.setTag("phone_auth_country");countries.setTextColor(TEXT);countries.setContentDescription("Telefon ülke kodu: "+country.name+", +"+country.callingCode);countries.setEnabled(!busy);row.addView(countries,new LayoutParams(dp(112),-1));
            phoneInput=input(country.iso.equals("TR")?"5xx xxx xx xx":"Telefon numaran",InputType.TYPE_CLASS_PHONE,phoneValue,28);phoneInput.setContentDescription("Telefon numaran");phoneInput.setBackgroundColor(android.graphics.Color.TRANSPARENT);phoneInput.setPadding(dp(8),0,0,0);row.addView(phoneInput,new LayoutParams(0,-1,1));
            phoneInput.addTextChangedListener(new TextWatcher(){public void beforeTextChanged(CharSequence s,int start,int count,int after){}public void onTextChanged(CharSequence s,int start,int before,int count){String value=s.toString().trim();if(country.iso.equals("TR")&&!value.startsWith("00")&&value.startsWith("0"))phoneInput.setError("Başına 0 eklemeden yaz: 5xx xxx xx xx.");}public void afterTextChanged(Editable value){}});
            if(register){CheckBox bind=new CheckBox(getContext());bind.setText("Mevcut hesabımı telefonuma bağlayacağım");bind.setTextColor(MUTED);bind.setTextSize(12);bind.setChecked(binding);bind.setEnabled(!busy);addView(bind,space(-1,48,10));bind.setOnCheckedChangeListener((view,value)->{capture();binding=value;render();});if(binding){existingInput=input("16 haneli mevcut kullanıcı kodun",InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_PASSWORD,existingValue,24);addView(existingInput,space(-1,54,0));}}
            showError();Button send=primary(busy?"Kod gönderiliyor…":register?"WhatsApp ile hesap oluştur":"WhatsApp ile giriş yap",this::sendPhone);send.setEnabled(!busy);addView(send,space(-1,54,20));
            if(register&&!binding)addView(text("Ücretsiz deneme: yalnız ilk üyelikte 3 saat.",11,MUTED,false),space(-1,-2,12));
            addView(link("Kullanıcı koduyla giriş",()->change(Mode.CODE,false)),space(-1,44,14));
        }else{
            accountInput=input("16 haneli kullanıcı kodun",InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_PASSWORD,accountValue,24);accountInput.setContentDescription("16 haneli kullanıcı kodun");accountInput.setImeOptions(EditorInfo.IME_ACTION_DONE);accountInput.setOnEditorActionListener((v,id,event)->{if(id==EditorInfo.IME_ACTION_DONE){loginCode();return true;}return false;});addView(accountInput,space(-1,54,24));
            showError();Button submit=primary(busy?"Giriş yapılıyor…":"Giriş yap",this::loginCode);submit.setEnabled(!busy);addView(submit,space(-1,54,20));
            addView(link("Telefonla giriş",()->change(Mode.PHONE,false)),space(-1,44,12));
            if(!phoneEnabled&&!checking)addView(text("Telefonla giriş şu an kullanılamıyor. Kullanıcı kodunla devam edebilirsin.",12,MUTED,false),space(-1,-2,8));
            if(checking)addView(text("Giriş seçenekleri kontrol ediliyor…",12,MUTED,false),space(-1,-2,8));
        }
        if(!phoneEnabled)addView(link("Web sitesinde hesap oluştur",this::website),space(-1,44,8));
    }
    private void sendPhone(){if(busy)return;capture();String raw=phoneValue.trim().replaceAll("[\\s().-]","");if(raw.startsWith("00"))raw="+"+raw.substring(2);
        if(raw.startsWith("+900")||country.iso.equals("TR")&&!raw.startsWith("+")&&raw.startsWith("0")){error="Başına 0 eklemeden yaz: 5xx xxx xx xx.";render();return;}
        String e164=PhoneNumberUtils.formatNumberToE164(raw,country.iso);
        if(e164==null||!e164.matches("\\+[1-9][0-9]{7,14}")){error="Telefon numaranı kontrol et.";render();return;}
        busy=true;error="";render();final int ticket=++epoch;
        gateway.request(e164,register,binding?existingValue:"",new TvRepository.Callback<String>(){public void onResult(String maskedPhone){if(!current(ticket))return;busy=false;masked=maskedPhone;mode=Mode.OTP;otpValue="";render();}public void onError(Failure failure){failed(ticket,failure);}});
    }
    private void verify(){if(busy)return;capture();if(!otpValue.matches("[0-9]{6}")){error="6 haneli doğrulama kodunu gir.";render();return;}busy=true;error="";render();final int ticket=++epoch;gateway.verify(otpValue,success(ticket));}
    private void loginCode(){if(busy)return;capture();checking=false;busy=true;error="";render();final int ticket=++epoch;gateway.loginCode(accountValue,success(ticket));}
    private TvRepository.Callback<Boolean> success(int ticket){return new TvRepository.Callback<Boolean>(){public void onResult(Boolean result){if(!current(ticket))return;busy=false;if(Boolean.TRUE.equals(result)){completed=true;otpValue="";accountValue="";existingValue="";authenticated.run();}else{error="Giriş tamamlanamadı.";render();}}public void onError(Failure failure){failed(ticket,failure);}};}
    private void failed(int ticket,Failure failure){if(!current(ticket))return;busy=false;error=failure.code==Failure.Code.STALE?"İşlem değişti. Tekrar dene.":failure.message;if(mode==Mode.OTP){recovery=gateway.recoveryFor(failure);if(recovery!=PhoneAuthGateway.Recovery.NONE){gateway.cancelPending();mode=Mode.PHONE;otpValue="";masked="";removeCallbacks(ticker);}}render();}
    private void updateClock(){if(expiry!=null)expiry.setText(gateway.remainingSeconds()>0?"Kodun geçerlilik süresi: "+(gateway.remainingSeconds()/60)+":"+String.format(Locale.ROOT,"%02d",gateway.remainingSeconds()%60):"Kodun süresi doldu. Yeni bir kod isteyebilirsin.");if(verifySubmit!=null)verifySubmit.setEnabled(!busy&&gateway.remainingSeconds()>0);if(resend!=null){int seconds=gateway.resendSeconds();resend.setText(seconds>0?"Yeniden gönder ("+seconds+" sn)":"Kodu yeniden gönder");resend.setEnabled(!busy&&seconds==0);}}
    private void website(){try{getContext().startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse("https://flixify.vip/kayit-ol")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));}catch(RuntimeException unavailable){error="Telefonunun tarayıcısında flixify.vip/kayit-ol adresini aç.";render();}}
    private void showError(){if(!error.isEmpty()){TextView message=text(error,13,TEXT,false);message.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);addView(message,space(-1,-2,12));}}
    private EditText input(String hint,int type,String value,int max){EditText input=new EditText(getContext());input.setSaveEnabled(false);input.setFreezesText(false);input.setTextColor(TEXT);input.setHintTextColor(MUTED);input.setTextSize(16);input.setSingleLine(true);input.setInputType(type);input.setFilters(new InputFilter[]{new InputFilter.LengthFilter(max)});input.setBackground(field());input.setPadding(dp(14),0,dp(14),0);input.setHint(hint);input.setText(value);input.setEnabled(!busy);return input;}
    private void chooseCountry(){
        if(busy||countryDialog!=null)return;
        LinearLayout content=new LinearLayout(getContext());content.setOrientation(VERTICAL);content.setPadding(dp(16),dp(8),dp(16),0);
        EditText search=input("Ülke veya telefon kodu ara",InputType.TYPE_CLASS_TEXT,"",60);search.setContentDescription("Ülke veya telefon kodu ara");search.setTag("phone_auth_country_search");content.addView(search,new LayoutParams(-1,dp(54)));
        FrameLayout results=new FrameLayout(getContext());int height=Math.max(dp(120),Math.min(dp(360),getResources().getDisplayMetrics().heightPixels-dp(240)));content.addView(results,new LayoutParams(-1,height));
        ListView list=new ListView(getContext());list.setTag("phone_auth_country_list");list.setChoiceMode(ListView.CHOICE_MODE_SINGLE);results.addView(list,new FrameLayout.LayoutParams(-1,-1));
        TextView empty=text("Ülke bulunamadı.",14,MUTED,false);empty.setGravity(Gravity.CENTER);empty.setTag("phone_auth_country_empty");results.addView(empty,new FrameLayout.LayoutParams(-1,-1));list.setEmptyView(empty);
        ArrayAdapter<PhoneCountries.Country> choices=new ArrayAdapter<PhoneCountries.Country>(getContext(),android.R.layout.simple_list_item_single_choice,new ArrayList<>(PhoneCountries.all())){
            @Override public View getView(int position,View view,android.view.ViewGroup parent){CheckedTextView row=(CheckedTextView)super.getView(position,view,parent);row.setText(getItem(position).label());row.setTextSize(14);row.setTextColor(TEXT);row.setBackgroundColor(PANEL);row.setMinHeight(dp(52));row.setCheckMarkTintList(android.content.res.ColorStateList.valueOf(RED));return row;}
        };
        list.setAdapter(choices);for(int i=0;i<choices.getCount();i++)if(choices.getItem(i)==country){list.setItemChecked(i,true);list.setSelection(i);break;}
        countryDialog=new AlertDialog.Builder(getContext(),android.R.style.Theme_Material_Dialog_Alert).setTitle("Ülke seç").setView(content).setNegativeButton("Kapat",null).create();
        list.setOnItemClickListener((parent,view,position,id)->{PhoneCountries.Country selected=choices.getItem(position);if(selected==null||busy||detached)return;capture();country=selected;error="";countryDialog.dismiss();render();});
        search.addTextChangedListener(new TextWatcher(){public void beforeTextChanged(CharSequence text,int start,int count,int after){}public void onTextChanged(CharSequence text,int start,int before,int count){choices.clear();choices.addAll(PhoneCountries.search(text.toString()));list.clearChoices();for(int i=0;i<choices.getCount();i++)if(choices.getItem(i)==country){list.setItemChecked(i,true);break;}list.setSelection(0);}public void afterTextChanged(Editable text){}});
        countryDialog.setOnDismissListener(dialog->countryDialog=null);countryDialog.show();if(countryDialog.getWindow()!=null){countryDialog.getWindow().setBackgroundDrawable(field());countryDialog.getWindow().setSoftInputMode(android.view.WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE|android.view.WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_HIDDEN);}
    }
    private TextView text(String value,int size,int color,boolean bold){TextView view=new TextView(getContext());view.setText(value);view.setTextSize(size);view.setTextColor(color);view.setTypeface(Typeface.DEFAULT,bold?Typeface.BOLD:Typeface.NORMAL);view.setGravity(Gravity.START);return view;}
    private Button link(String value,Runnable action){Button button=new Button(getContext());button.setAllCaps(false);button.setText(value);button.setTextSize(13);button.setTextColor(MUTED);button.setBackgroundColor(android.graphics.Color.TRANSPARENT);button.setMinWidth(0);button.setPadding(dp(4),0,dp(4),0);button.setOnClickListener(v->action.run());return button;}
    private Button primary(String value,Runnable action){Button button=link(value,action);GradientDrawable fill=new GradientDrawable();fill.setColor(RED);fill.setCornerRadius(dp(10));button.setBackground(fill);button.setTextColor(BG);button.setTypeface(Typeface.DEFAULT,Typeface.BOLD);return button;}
    private GradientDrawable field(){GradientDrawable field=new GradientDrawable();field.setColor(PANEL);field.setStroke(dp(1),LINE);field.setCornerRadius(dp(11));return field;}
    private LayoutParams space(int width,int height,int top){LayoutParams params=new LayoutParams(width<0?width:dp(width),height<0?height:dp(height));params.topMargin=dp(top);return params;}
    private int dp(int value){return Math.round(value*getResources().getDisplayMetrics().density);}
    @Override protected void onDetachedFromWindow(){detached=true;epoch++;removeCallbacks(ticker);if(countryDialog!=null)countryDialog.dismiss();gateway.cancelPending();super.onDetachedFromWindow();}
    @Override protected void onAttachedToWindow(){super.onAttachedToWindow();detached=false;if(mode==Mode.OTP)post(ticker);}
}
