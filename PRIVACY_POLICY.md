# WayMark Privacy Policy

Last updated: March 2, 2026

## 1. Overview

WayMark helps users interact with data stored in their Google Sheets and Google Drive. This Privacy Policy explains what information WayMark processes, how it is used, and your choices.

## 2. Browser-First Architecture

WayMark is designed so that **all data processing happens entirely in your web browser**. The WayMark server serves the application files and brokers OAuth authentication — it never receives, inspects, or stores your spreadsheet content, Drive files, or any other user data.

Specifically:

- Your Google Sheets and Drive data is fetched directly from Google's APIs by JavaScript running in your browser.
- Template detection, data analysis, import processing, and all rendering happen client-side.
- The WayMark server has zero access to your file contents at any time.

## 3. Information We Process

WayMark may process the following **in your browser**:

- Google account basic profile information (name, email, profile image)
- Google OAuth tokens required to access approved Google APIs
- Google Drive and Google Sheets metadata and content needed to render app features
- Data you import from external files or URLs (processed entirely client-side)

WayMark does not sell personal information.

## 4. Google API Data Use

WayMark uses Google APIs only to provide core application features requested by the user, including:

- Browsing Drive folders and files
- Reading and updating spreadsheet data
- Storing user preferences and settings in your own Google Drive (via a WayMark app-data file)

All Google API calls are made directly from your browser to Google's servers. WayMark's use and transfer of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements.

## 5. Data Import and Recipe Scraping

WayMark allows you to import data from Google Sheets, Google Docs, and recipe URLs:

- **File imports**: Your browser reads the source file via Google APIs, analyzes its structure, and writes the converted data to a new Google Sheet — all client-side.
- **Recipe URL imports**: Your browser fetches the recipe page, extracts structured data (ingredients, steps, etc.), and creates a Google Sheet — the WayMark server is not involved in this process.

No imported content is transmitted to or stored on WayMark's servers.

## 6. Authentication and Session Handling

- OAuth uses Google's authorization flow.
- A short-lived access token is held in memory in your browser.
- A refresh token may be stored in a secure, HTTP-only cookie managed by the server.
- Session cookies are used only for authentication and session continuity.
- The server never uses these tokens to access your data on your behalf — they are returned to your browser for client-side API calls.

## 7. Data Storage and Retention

- **Google Drive**: Your canonical data (sheets, files) and WayMark user preferences are stored in your own Google Drive account.
- **Browser localStorage**: The app stores non-sensitive UI preferences (theme, sidebar state, tutorial progress) in your browser's local storage. This data never leaves your device.
- **WayMark server**: Stores nothing. No database, no cache, no session store, no user data of any kind.
- Local development and test modes may use local fixture/mock data.

## 8. Data Sharing

WayMark does not share your data with third parties except:

- Google services you explicitly authorize through OAuth
- Service providers required to host or operate the app
- Legal obligations or lawful requests

Because all data processing is browser-based, your file contents are never accessible to WayMark infrastructure.

## 9. Security

WayMark uses reasonable safeguards, including HTTPS (in production), secure cookie practices, and least-privilege API scope usage where possible. The browser-first architecture means your data exposure is limited to your own browser session and Google's APIs. No method of transmission or storage is 100% secure.

## 10. Your Choices and Rights

You can:

- Revoke app access in your Google Account permissions settings
- Clear browser localStorage to remove local preferences
- Request deletion of application-controlled data where applicable
- Stop using the app at any time

Depending on your jurisdiction, you may have additional privacy rights.

## 11. Children's Privacy

WayMark is not intended for children under 13 (or the equivalent minimum age in your jurisdiction).

## 12. Changes to This Policy

This policy may be updated from time to time. The "Last updated" date will reflect changes.

## 13. Contact

For privacy inquiries, use your project support contact email and/or website support channel.
