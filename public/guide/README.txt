Client Setup Guide — screenshots
=================================

Drop screenshot image files into THIS folder. The guide page (/guide) shows them
automatically by filename — no code changes needed. Until a file exists, the page
shows a dashed placeholder box with the exact filename it's waiting for.

Expected filenames (PNG or JPG):

  channels.png         Control Centre -> Channels
  store-files.png      Control Centre -> Store Files (upload)
  cams.png             Control Centre -> CAMs
  new-client.png       Clients -> New Client form
  control-files.png    Client page -> Control tab (the 5 control-file slots)
  pmf-mapping.png      PMF field mapping
  links-mapping.png    Links field mapping
  report-settings.png  Client page -> Report Settings (DSC / OTO / SharePoint)
  logo-tab.png         Client page -> Logo tab
  status-reference.png Status Reference page (definitions + scenarios)
  data-load.png        Data Load page
  reports.png          Reports page

Keep images reasonably sized (<= ~1600px wide). Use the exact filename above so the
page picks it up. If you want to add more, add a <Figure src="/guide/xxx.png" .../>
in app/(portal)/guide/page.tsx.
