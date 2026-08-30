<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Grocery Shop Manager

A local shop app for sales, stock, and profit. Data is stored in a `grocery.db` file on the computer.

View your app in AI Studio: https://ai.studio/apps/d12e9507-86ac-40a0-8f0d-ca2d925e8f73

## Run on any computer (no Node.js needed)

On a computer that already has Node.js 22 or newer:

```
npm install
npm run package
```

That creates zip files in the `release` folder. Copy the zip for the shop computer:

| Computer | Zip file | What to double-click |
| --- | --- | --- |
| Windows | `GroceryShop-windows-x64.zip` | `Start Grocery Shop.bat` (or `GroceryShop.exe`) |
| Linux | `GroceryShop-linux-x64.zip` | `Start-Grocery-Shop.sh` (or `GroceryShop`) |
| Mac (Apple Silicon) | `GroceryShop-macos-arm64.zip` | `Start Grocery Shop.command` (or `GroceryShop`) |

Then:

1. Unzip the folder on the shop computer (Desktop is fine).
2. Double-click the start file.
3. The shop opens at http://localhost:3000
4. Leave the black/terminal window open while you work. Close it to stop the shop.

The shop computer does **not** need Node.js, npm, or an internet connection after you copy the folder.

Your products and sales are saved in `grocery.db` in that same folder. Copy that file to back up or move the shop.

## Run locally with Node.js

**Prerequisites:** Node.js 22.13 or newer

1. Install dependencies:
   `npm install`
2. Optional: set `GEMINI_API_KEY` in `.env.local` if you use Gemini features
3. Start in development mode:
   `npm run dev`

Or build once, then start:

```
npm run build
npm start
```

The app is at http://localhost:3000
