# Firebase public client configuration

Place the Firebase-generated `GoogleService-Info.plist` for bundle `vip.flixify.mac` in this directory. The packager validates its bundle ID and public Google application/project/API identifiers, then copies it to the application's sealed resources. This file is public SDK configuration, not a Measurement Protocol secret. No service-account file, private key, notary credential or analytics API secret belongs here.

Without a valid configuration, analytics reports unavailable and never collects. Debug/fixture builds never collect production data. Collection defaults to disabled in the installed app's Info.plist; a versioned explicit user choice is required before Firebase initialization. Advertising/IDFV collection remains disabled.
