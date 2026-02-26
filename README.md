# Spatial Misalignment of Urban Development and Climate Risk
## Multi-City Analysis (2000–2020)

### Project Structure

This project contains:
  - Spatial_Misalignment.ipynb → Primary analysis file (Python + Earth Engine API)
  - Spatial_Misalignment_GEE.js → Backup JavaScript version (Google Earth Engine Code Editor)
  - urban_climate_analysis_results → contains output plot images from the python notebook

The notebook should be considered the primary submission, as it contains:
All statistical outputs
Cross-city comparison tables
Plots and visualizations
Structured report sections

The JavaScript file is provided as a fallback in case the notebook environment fails.
### How to Run the Notebook

This project uses the Google Earth Engine (GEE) Python API.
To run the notebook successfully, you must create and configure a Google Earth Engine project.

Step 1 - Create a Google Earth Engine Project

- Go to: https://code.earthengine.google.com/
- Sign in with a Google account.
- If prompted, register for Earth Engine access.
- Go to: https://console.cloud.google.com/
- Create a new project (or use an existing one).
- Enable the Earth Engine API for that project.
- Copy your Project ID.

Step 2 - Initialize Earth Engine in the Notebook

- Inside the first cell of the notebook, you will see: ee.Initialize(project="YOUR_PROJECT_ID")
- Replace: YOUR_PROJECT_ID with your actual Google Cloud Project ID.
Example:
ee.Initialize(project="my-gee-project-123")

Step 3 - Authenticate (First-Time Setup)

- If running locally or in Colab, you may need to authenticate: ee.Authenticate()
- Then rerun: ee.Initialize(project="your-project-id")
- 
Step 4 - Run Cells Sequentially
- Run all notebook cells in order from top to bottom.
- The notebook will:
    - Load CHIRPS rainfall data
    - Load MODIS NDVI data
    - Load GHSL built-up and population datasets
    - Compute pixel-level trends (2000–2020)
    - Apply spatial smoothing
    - Perform sampling (n=500, seed=42)
    - Compute correlation and exposure metrics
    - Generate plots and cross-city summaries

## Important Notes
We used Colab to run the .ipynb file
### Primary File:
The .ipynb file is the authoritative version because it:
-Contains spatial smoothing implementation
-Includes reproducible sampling (seed = 42)
-Produces visualizations required for interpretation
-Contains structured written analysis

### Backup JavaScript Version
The .js file is provided for:
-Verification in the GEE Code Editor
-Manual rerunning in case the notebook fails
-Cross-checking outputs
-To run it:
  1- Open https://code.earthengine.google.com/
  2- Create a new script
  3- Paste the contents of the .js file
  4- Click Run



#Data Sources:

1- All datasets used are publicly available via Google Earth Engine:
2- CHIRPS Daily Rainfall
3- MODIS MOD13Q1 NDVI
4- GHSL Built Surface
5- GHSL Population Grid
6- Time period analyzed: 2000–2020
