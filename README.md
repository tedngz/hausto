# Welcome to your Lovable project

## Project info

**URL**: https://lovable.dev/projects/614aa0f7-490d-413a-8576-174e6d3df45e

## How can I edit this code?

There are several ways of editing your application.

**Use Lovable**

Simply visit the [Lovable Project](https://lovable.dev/projects/614aa0f7-490d-413a-8576-174e6d3df45e) and start prompting.

Changes made via Lovable will be committed automatically to this repo.

**Use your preferred IDE**

If you want to work locally using your own IDE, you can clone this repo and push changes. Pushed changes will also be reflected in Lovable.

The only requirement is having Node.js & npm installed - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

Follow these steps:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd <YOUR_PROJECT_NAME>

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the development server with auto-reloading and an instant preview.
npm run dev
```

**Edit a file directly in GitHub**

- Navigate to the desired file(s).
- Click the "Edit" button (pencil icon) at the top right of the file view.
- Make your changes and commit the changes.

**Use GitHub Codespaces**

- Navigate to the main page of your repository.
- Click on the "Code" button (green button) near the top right.
- Select the "Codespaces" tab.
- Click on "New codespace" to launch a new Codespace environment.
- Edit files directly within the Codespace and commit and push your changes once you're done.

## What technologies are used for this project?

This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

## How can I deploy this project?

Simply open [Lovable](https://lovable.dev/projects/614aa0f7-490d-413a-8576-174e6d3df45e) and click on Share -> Publish.

That publishes the frontend. The Supabase edge functions under `supabase/functions`
are deployed separately, by `.github/workflows/deploy-functions.yml`, which runs on
every push to `main` that touches them. It needs one repository secret,
`SUPABASE_ACCESS_TOKEN` (Settings -> Secrets and variables -> Actions); the project
ref comes from `project_id` in `supabase/config.toml`. Without the secret the job
skips with a notice rather than failing, and the functions stay on whatever version
was last pushed by hand - which is worth knowing when a merged fix doesn't show up
in the app.

## Can I connect a custom domain to my Lovable project?

Yes, you can!

To connect a domain, navigate to Project > Settings > Domains and click Connect Domain.

Read more here: [Setting up a custom domain](https://docs.lovable.dev/tips-tricks/custom-domain#step-by-step-guide)
