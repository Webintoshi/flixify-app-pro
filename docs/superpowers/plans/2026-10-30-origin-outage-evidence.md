# Actual playback attempt / origin outage —2026-10-30

User reported996fix still slow/freezing, signed into provider panel, and then explicitly authorized one real channel test after closing their other device. No parallel probe/media request was opened.

## Read-only provider checks

- Current VPS card:87.76.130.17 / edge.flixify.vip, online,6cores,0%CPU,7%RAM563/7936MB,0connections at observation. Only this current VPS listed; no restart/edit/delete applied.
- Active app account expires26Nov2026; matched current provider line4442 expiry2026-11-26. Line has Private CDN andEPG enabled, max_connections1, future expiry. No form value or subscription changed. Another legacy paid line2739 lacks CDN, but was not assumed to be the affected account and was not touched.
- Connections page was read passively with identifiers/credentials/IP redacted. A prior4442session reported Windows UA and series content; user subsequently confirmed their other player was closed.

## One authorized attempt

- Chose Atv HD in existing authenticated production tab10. At+343ms no video element yet, UI preparing. By+23.861s there was still NOvideo/LiveVideo, with generic LIVE startup error and EPG error. Console/warnings empty. No media resource/first frame was reached. Closed selected player afterward, confirming zero videos/player shell.
- The code path and shared bootstrap strongly implicate the pre-media API authorization path, but browser ResourceTiming is unavailable in CUA read-only scope and exact HTTP response/status of that authenticated request was not captured. Do not invent timings beyond those wall-clock samples.

## Concurrent current infrastructure evidence

- Coolify /terminal returned500 with `php_network_getaddresses: getaddrinfo for coolify-redis failed: Try again`.
- From the Mac: https://api.flixify.vip/health TLS connect timeout at5s; subsequent https://flixify.vip/canli-tv TLS handshake timeout at10s; SSH to87.76.130.252 timed out waiting for banner at5s, before authentication. No key/password failure was diagnosed.
- DNS resolves flixify.vip, api.flixify.vip, coolify.flixify.vip to87.76.130.252; edge.flixify.vip to87.76.130.17.
- Read-only SSH to edge17 still worked with negligible load. From that independent Turkey host, HTTPS root requests to all three origin domains timed out at6.1s and SSH252banner timed out at5.01s. SSH17was closed afterward. This confirmed origin accessibility failure from two locations, separate from the healthy edge host. The resource cause was not yet known at this observation; the subsequent console and guest findings are recorded below.
- Existing local ~/.ssh/coolify_host_key referenced by scripts/ssh-server.mjs is not present; ssh-agent has no identities. Unrelated Hetzner key was not the issue in the252attempt because server never sent its SSH banner. No credential/key/security setting changed.

## Verified console access and guest diagnosis

On 30 October 2026, the Verisunucu out-of-band console verified that product 3704 is active 87.76.130.252. Historical product 3931 was not used as an assumed IP mapping. Suspended 191.44.68.37 and expired 191.44.68.249 remained out of scope. SSH access to 87.76.130.252 subsequently became available.

- The console showed contemporary global and cgroup OOM kills involving Python UID 10001 and Java UID 1000, plus an older journald no-space event. Panel disk usage was 92%, 64.71/70 GB. Guest measurements, rather than the panel's RAM percentage, were used for diagnosis.
- Guest `free -m` reported total 15988 MiB, used 13547 MiB, free 423 MiB, available 1743 MiB and swap 1802/1823 MiB used; another pre-mitigation sample had available 1559 MiB. The observed `docker stats` memory total was only about 3 GiB. The running Python process was attributed to `kokoro-jp-studio`, limited to 6 GiB and using about 915 MiB at that sample; it was not stopped or killed.
- `vmware-toolbox-cmd stat balloon` reported 10195 MB. `/sys/kernel/debug/vmmemctl` reported both current and target 2609999 pages, approximately 9.96 GiB at 4 KiB/page. The loaded module was `vmw_balloon`, use count 0. The toolbox reported memory limit 4294967295 MB, interpreted as no configured VM limit, and reservation 0 MB.
- This directly accounted for the otherwise unexplained guest memory: VMware had reclaimed about 10 GiB of a 16 GiB VM through its balloon. The guest had substantial swap use and contemporary global OOM events. The specific hypervisor/resource-pool policy or physical-host capacity causing reclamation was not established from inside the guest; provider oversubscription was not proven.

## Temporary recovery performed on 30 October 2026

- The parent operator ran normal checked removal `timeout 15 modprobe -r vmw_balloon` through SSH; it exited 0. No forced module removal, reboot, persistent blacklist, swapoff, application deployment, or change to another application's configuration was performed.
- Immediately afterward, `free -m` reported used 3727 MiB, free 11008 MiB and available 11385 MiB; the balloon statistic was 0 MB. The 20:01 guest sample (`date -Is`: UTC+03:00) showed available 11696 MiB and current `vmstat` swap-in/swap-out 0. No new OOM appeared in the preceding 3 minutes at that check. At 20:12:38+03:00, available memory was 10514 MiB, balloon 0 MB, and the kernel journal contained zero new `Out of memory` entries since 20:00. These are bounded observations, not a long-term stability guarantee.
- Coolify resolved `coolify-redis` to 10.0.1.6. All four Flixify containers were running without a restart. API health returned HTTP 200 in approximately 0.150 s. No Docker daemon, network or application container was recreated for this recovery.
- User-authorized unused disk cleanup ran `apt-get clean`: downloaded package archives fell from 109 MB to 24 KB. Actual filesystem samples during this session showed 81–84% used and 11–13 GB free, with concurrent activity on this shared server. These values are observations; filesystem movement is not wholly attributed to the 109 MB apt cleanup. BuildKit's 32 reported cache records were all `Reclaimable=false`, so none were pruned. No image, volume, Docker data directory or database file was deleted. Edge 87.76.130.17 had 11 GiB free (37% used), 7369 MiB available RAM and load 0.02 at 20:04+03:00; no cleanup or service change was necessary there.

The Linux 5.15 driver exit handler cancels balloon work, resets its monitor connection and frees the reserved balloon pages. This explains why normal module removal could restore guest memory without restarting applications. See the [official Linux 5.15 driver source](https://github.com/torvalds/linux/blob/v5.15/drivers/misc/vmw_balloon.c#L1841-L1857).

This is temporary guest-side relief. The provider must review physical-host/resource-pool pressure and reserve the VM's required memory; a guest balloon bypass does not guarantee physical backing and may shift pressure to hypervisor compression or swapping. Broadcom recommends case-by-case consultation and documents reserving all guest memory; its alternative `sched.mem.maxmemctl=0` method explicitly requires VM shutdown. No such shutdown or persistent host-policy change was performed. Sources: [Broadcom balloon-disable guidance](https://knowledge.broadcom.com/external/article/408718/disable-memory-ballooning-in-a-vm.html), [Broadcom VM resource-limit behavior](https://knowledge.broadcom.com/external/article?legacyId=1033115).

Rollback for this temporary module removal is `modprobe vmw_balloon`. Reloading may immediately restore the host-requested approximately 10 GiB balloon and reintroduce guest memory pressure, so it must be coordinated with the provider's memory correction rather than run automatically. No persistent blacklist was installed; ballooning can return after a reboot or module reload.

## Sequential single-connection playback validation

- After the recovery, Atv HD produced a video element within 308 ms. At wall-clock +30.956 s, video time was 29.010 s, readyState 4, playing, with 10.710 s buffered ahead. At +75.160 s, video time was 69.916 s, readyState 2 and its buffer was exhausted. At +119.377 s, it was paused at 70.001 s, with the browser accessibility text “Medya oynatılamıyor.” No application retry/error overlay or console error was observed. The CUA DOM facade does not expose `video.error` (its type was later verified as `undefined`); earlier `error:null` output came from a diagnostic fallback and must not be treated as an actual native MediaError reading. The first post-recovery test therefore did not establish continuous stability. Its player was closed and zero video elements confirmed.
- A subsequent sequential Atv HD test, with no parallel media connection, advanced normally in the sampled states: at +41.859 s, video time 37.495 s; at +108.079 s, video time 103.708 s; at +171.893 s, video time 167.532 s. Each sample showed readyState 4, paused false, ended false, reconnect attempt 0 and buffered media ahead. Source protocol HTTPS (rather than a blob) identified the native media path; duration was Infinity and the document was not hidden at the captured samples. Exact first-frame timing and all transient stall events were not captured. The final buffer range was 150–179.72 s. Closed the player, confirmed zero videos and closed the test tab to release the user's one-connection line.
- This separates the resolved origin memory crisis from a remaining unclassified native playback interruption seen in the first post-recovery attempt. No unproven client/player change was deployed. The successful roughly 172-second repeat is a bounded positive playback check, not proof that every channel or a full match is interruption-free.

At the outage observation, production source was 996d4e434e47cb1e22cd936a406f2fc7e95a1052 / image bd2e42822516acedabd2480e5d85a1cb524c86097269df9069d375b8c4a185ca. No application change or deployment was performed as part of the infrastructure recovery above.
