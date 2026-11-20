# Flickr sync for the personal website

This imports metadata and Flickr-hosted URLs, not image files. The `/flickr` page in the
`personalwebsite` repository displays the imported public photostream, at most 30 images per page,
and links each image to Flickr. The existing uploaded-photo portfolio stays separate. This version
imports the photostream, not Flickr albums; it does not import private photos or videos.

1. Apply for a [Flickr API key](https://www.flickr.com/services/api/keys/) for your use. Find your
   account's NSID (the Flickr numeric ID ending in `@N...`), for example with Flickr's API explorer.
   Keep the key on the CMS server. The [API terms](https://www.flickr.com/help/terms/api) describe
   the conditions for commercial use.
2. Add `FLICKR_API_KEY`, `FLICKR_USER_ID` and `FLICKR_SYNC_SECRET` to `apps/cms/.env` on the CMS
   server. Use `openssl rand -hex 32` for the sync secret. Never commit these values or put them in
   website variables. Deploy the CMS change and the website change using your usual process.
3. Run `cd ~/payloadcms/apps/cms && ./deploy/sync-flickr.sh`. Check the count and exit status;
   failures are also logged by `docker compose logs cms`. In Payload, Personal website → Flickr
   photos lists the records. Untick **Display on website** to hide an individual photo; future syncs
   preserve that choice. Add `/flickr` to the site's menu in Payload if desired. The existing
   `/photos` page also links to it.
4. Set up a six-hour schedule on the CMS host, using the real absolute checkout path. For example,
   edit the deploying user's crontab (`crontab -e`) and add one line:

   ```cron
   10 */6 * * * /usr/bin/flock -n /tmp/payload-flickr-sync.lock /home/YOUR_USER/payloadcms/apps/cms/deploy/sync-flickr.sh >> /home/YOUR_USER/flickr-sync.log 2>&1
   ```

   Replace both `/home/YOUR_USER` paths and confirm that this user can run `docker compose`.
   Run one manual sync first and monitor the log for errors. Run only one scheduler per CMS/database.
   Restart/redeploy the CMS after changing its `.env`. The scheduler is not installed automatically.

Only a complete successful Flickr listing is used to reconcile removed or private photos. Old
records stop appearing automatically after 20 hours without a complete sync. This is a six-hour
poll, so a privacy change is not instant. If you need immediate removal, hide the photo in Payload or
run the sync immediately. The gallery requests fresh CMS data on every page load and uses no-store
headers. A Flickr API outage can eventually leave the gallery empty. Flickr image requests are made
by visitors' browsers, so account for that in your site's privacy notice.
