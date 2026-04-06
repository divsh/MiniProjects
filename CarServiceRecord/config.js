/**
 * Car Service Record — Configuration
 *
 * Edit the three values below before deploying.
 * After deploying to GitHub Pages, add the URL to your
 * Google Cloud Console → OAuth → Authorized JavaScript origins.
 */
const CONFIG = {

  // Google OAuth Client ID (from Google Cloud Console → APIs & Services → Credentials)
  GOOGLE_CLIENT_ID: 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com',

  // Only these Gmail addresses can log in (comma-separated list)
  ALLOWED_EMAILS: [
    'your.email@gmail.com'
  ],

  // Deployed Google Apps Script Web App URL (from Apps Script → Deploy → Manage Deployments)
  APPS_SCRIPT_URL: 'https://script.google.com/macros/s/YOUR_SCRIPT_DEPLOYMENT_ID/exec'

};
