// ==========================================
// 1. DEFINE AREA AND TIME
// ==========================================
// var cityPoint = ee.Geometry.Point([106.8456, -6.2088]); // Jakarta (Change as needed)

// OPTION B: Houston, USA (Sprawl, Frequent Hurricanes)
// var cityPoint = ee.Geometry.Point([-95.3698, 29.7604]); 

// OPTION C: Nairobi, Kenya (Inland, Rapid Informal Expansion)
// var cityPoint = ee.Geometry.Point([36.8219, -1.2921]); 

// OPTION D: Dhaka, Bangladesh (High Density, Deltaic)
var cityPoint = ee.Geometry.Point([90.4125, 23.8103]);
var roi = cityPoint.buffer(20000); 
Map.centerObject(roi, 11);

var startYear = 2000;
var endYear = 2020;

// ==========================================
// 2. PREPARE RAINFALL DATA (Climate Driver)
// ==========================================
var rainCollection = ee.ImageCollection("UCSB-CHG/CHIRPS/DAILY")
  .filterDate(startYear + '-01-01', endYear + '-12-31')
  .filterBounds(roi);

var annualMaxRain = ee.List.sequence(startYear, endYear).map(function(year) {
  var startDate = ee.Date.fromYMD(year, 1, 1);
  var maxRain = rainCollection.filterDate(startDate, startDate.advance(1, 'year')).max();
  // FIX: Added .float() to ensure all images have the same data type
  return maxRain.addBands(ee.Image.constant(year).rename('year').float())
                .set('system:time_start', startDate.millis());
});

var rainTrend = ee.ImageCollection(annualMaxRain).select(['year', 'precipitation']).reduce(ee.Reducer.linearFit());

// ==========================================
// 3. PREPARE VEGETATION DATA (Development Driver)
// ==========================================
var ndviCollection = ee.ImageCollection("MODIS/006/MOD13Q1")
  .filterDate(startYear + '-01-01', endYear + '-12-31');

var annualMeanNDVI = ee.List.sequence(startYear, endYear).map(function(year) {
  var startDate = ee.Date.fromYMD(year, 1, 1);
  var meanNDVI = ndviCollection.filterDate(startDate, startDate.advance(1, 'year')).mean().multiply(0.0001);
  // FIX: Added .float() here as well
  return meanNDVI.addBands(ee.Image.constant(year).rename('year').float())
                .set('system:time_start', startDate.millis());
});

var ndviTrend = ee.ImageCollection(annualMeanNDVI).select(['year', 'NDVI']).reduce(ee.Reducer.linearFit());

// ==========================================
// 4. POPULATION DATA
// ==========================================
// Load WorldPop data for 2020
var pop = ee.ImageCollection("WorldPop/GP/100m/pop")
  .filterDate('2020-01-01', '2020-12-31')
  .first()
  .clip(roi);

// ==========================================
// 5. VISUALIZATION
// ==========================================
Map.addLayer(pop, {min: 0, max: 50, palette: ['white', 'purple']}, 'Population Density (2020)', false);
Map.addLayer(rainTrend.select('scale').clip(roi), {min: -0.5, max: 0.5, palette: ['white', 'blue']}, 'Rainfall Trend (Blue = Increasing)');
Map.addLayer(ndviTrend.select('scale').clip(roi), {min: -0.005, max: 0.005, palette: ['red', 'white', 'green']}, 'NDVI Trend (Red = Urbanizing)');

// ==========================================
// 6. THE SCATTER PLOT
// ==========================================
var combined = rainTrend.select('scale').rename('Rain_Trend')
  .addBands(ndviTrend.select('scale').rename('NDVI_Trend'));

var samples = combined.sample({
  region: roi,
  scale: 1000,
  numPixels: 500, 
  geometries: true
});

var chart = ui.Chart.feature.byFeature({
  features: samples,
  xProperty: 'NDVI_Trend',
  yProperties: ['Rain_Trend']
})
.setChartType('ScatterChart')
.setOptions({
  title: 'Urbanization vs. Rainfall Intensity Trend',
  hAxis: {title: 'Vegetation Trend (Left = Urbanization/Loss)'},
  vAxis: {title: 'Rain Trend (Top = Intensity Increase)'},
  pointSize: 3,
  trendlines: { 0: {showR2: true, color: 'black'} },
  series: { 0: {color: 'red'} }
});

// Calculate the correlation coefficient (r) with the correct function name
var correlation = samples.reduceColumns({
  reducer: ee.Reducer.pearsonsCorrelation(), // Added the 's'
  selectors: ['NDVI_Trend', 'Rain_Trend']
});

print('--- STATISTICAL RESULTS ---');
print('Pearson Correlation (r):', correlation.get('correlation'));

// Calculate R-squared (R2)
var r2 = ee.Number(correlation.get('correlation')).pow(2);
print('R-squared (R2):', r2);

print('--- FINAL ANALYSIS ---');
print(chart);

// ==========================================
// 6. QUANTIFYING ALIGNMENT VS MISALIGNMENT
// ==========================================

// Define the quadrants
var dangerZone = samples.filter(ee.Filter.and(
  ee.Filter.lt('NDVI_Trend', 0), 
  ee.Filter.gt('Rain_Trend', 0)
));

var totalPoints = samples.size();
var dangerPoints = dangerZone.size();
var alignmentPct = ee.Number(dangerPoints).divide(totalPoints).multiply(100);

print('--- COMPARISON METRICS ---');
print('Percentage of Aligned Risk (Top-Left Quadrant) %:', alignmentPct);