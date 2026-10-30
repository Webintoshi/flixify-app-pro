# Trial registration capacity

The user requests a higher daily trial registration limit after receiving the daily-limit error. Production inspection found the ten-registration quota was shared by every visitor: Fastify 5.12.5 rejects numeric `trustProxy: 1`, so `request.ip` remained the Traefik peer. The single active quota window had count ten and matched that peer's HMAC.

Use an explicit, validated proxy address list and make the daily quota configurable, default 1,000 registrations per real source IP per 24-hour quota window. Production trusts only the observed Traefik peer `10.0.2.4/32` and loopback. Reject unrestricted hop counts and broad or invalid address ranges, including broad IPv4-mapped IPv6 ranges. The peer address must be checked again if the proxy is recreated with a different IP.

Keep the existing three-hour trial, installation uniqueness, ten-per-minute burst limit, authorization, provider provisioning and atomic quota/account/job transaction. No database reset or schema migration is required. Existing proxy quota rows remain untouched.

Deploy a surgical overlay onto the pinned actual production API image. Its source differs from the repository baseline; replacing whole files would regress existing features. Compile the unmodified production sources first and require their output to match the existing deployed JavaScript before applying the four reviewed source changes. Preserve dependencies, other application files and image configuration. Change only the API image and the two non-secret API settings in Coolify; protect web, worker, database and `.env` bytes. Do not open customer media or create provider/customer trial accounts for verification.
