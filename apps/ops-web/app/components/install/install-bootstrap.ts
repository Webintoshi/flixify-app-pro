// Runs in the document head, before React hydrates. Chrome can emit its one-shot
// install event while the client bundles are still downloading.
export const installBootstrap = `(()=>{
if(!/Android/i.test(navigator.userAgent)||window.__flixifyInstallListening)return;
window.__flixifyInstallListening=true;
window.addEventListener('beforeinstallprompt',function(event){
event.preventDefault();window.__flixifyInstallPrompt=event;
});
window.addEventListener('appinstalled',function(){
window.__flixifyInstallPrompt=null;window.__flixifyAppInstalled=true;
});
})();`;
