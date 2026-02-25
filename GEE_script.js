
// ==========================================
// 1. SETUP & CONFIGURATION
// ==========================================

// SELECT YOUR CITY (Comment out all except one)
// var cityPoint = ee.Geometry.Point([73.0479, 33.6844]);   // Islamabad, Pakistan
// var cityPoint = ee.Geometry.Point([79.8612, 6.9271]);    // Colombo, Sri Lanka
// var cityPoint = ee.Geometry.Point([72.8777, 19.0760]);   // Mumbai, India
var cityPoint = ee.Geometry.Point([101.6869, 3.1319]);   // Kuala Lumpur, Malaysia
// var cityPoint = ee.Geometry.Point([120.1551, 30.2741]);  // Hangzhou, China
// var cityPoint = ee.Geometry.Point([106.8456, -6.2088]);  // Jakarta, Indonesia
// var cityPoint = ee.Geometry.Point([78.4867, 17.3850]);   // Hyderabad, India

var cityName = 'Kuala Lumpur'; // UPDATE THIS WITH YOUR CITY NAME

var roi = cityPoint.buffer(20000); 
Map.centerObject(roi, 11);
Map.addLayer(roi, {color: 'red'}, 'ROI Boundary');

// ==========================================
// 2. DATA LOADING
// ==========================================

var chirps = ee.ImageCollection("UCSB-CHG/CHIRPS/DAILY");
var modis = ee.ImageCollection("MODIS/061/MOD13Q1");
var popImage = ee.Image("JRC/GHSL/P2023A/GHS_POP/2020").select('population_count');

// CRITIQUE 2 FIX: Add Impervious Surface data (Built-up area)
// This better captures "absorption capacity loss" than NDVI alone
var builtUp2000 = ee.Image("JRC/GHSL/P2023A/GHS_BUILT_S/2000").select('built_surface');
var builtUp2020 = ee.Image("JRC/GHSL/P2023A/GHS_BUILT_S/2020").select('built_surface');

// Calculate built-up change (proxy for imperviousness increase)
var builtUpChange = builtUp2020.subtract(builtUp2000).divide(20); // Per year trend

// ==========================================
// 3. IMPROVED TREND CALCULATIONS
// ==========================================

var years = ee.List.sequence(2000, 2020);

// --- Rainfall Trend (Using consistent scale) ---
var rainColl = ee.ImageCollection(years.map(function(y) {
  var annual = chirps.filter(ee.Filter.calendarRange(y, y, 'year'))
    .reduce(ee.Reducer.percentile([95])).rename('rain');
  var time = ee.Image.constant(y).toFloat().rename('t');
  return ee.Image.cat([time, annual]).set('year', y);
}));

var rainTrend = rainColl.reduce(ee.Reducer.linearFit()).select('scale');

// --- Vegetation Trend (with Quality Filtering) ---
var ndviColl = modis.filterDate('2000-01-01', '2020-12-31')
  .filterBounds(roi)
  .map(function(img) {
    // Quality filtering: Use only reliable pixels
    var qa = img.select('SummaryQA');
    var goodQuality = qa.eq(0); // 0 = good quality
    
    // CRITICAL: Scale NDVI from integer (0-10000) to float (0-1)
    var ndvi = img.select('NDVI').multiply(0.0001).updateMask(goodQuality);
    
    var date = img.date();
    var year = date.get('year');
    var frac = date.getFraction('year');
    var time = ee.Image(year).add(frac).toFloat().rename('t');
    
    return ee.Image.cat([time, ndvi]);
  });

var ndviTrend = ndviColl.reduce(ee.Reducer.linearFit()).select('scale');

// ==========================================
// 4. NORMALIZE TO COMMON GRID (500m)
// ==========================================

// Reproject both trends to a common 500m grid to avoid scale mismatches
var projection = ee.Projection('EPSG:4326').atScale(500);

var rainTrendResampled = rainTrend.reproject({
  crs: projection,
  scale: 500
});

var ndviTrendResampled = ndviTrend.reproject({
  crs: projection,
  scale: 500
});

var popResampled = popImage.reproject({
  crs: projection,
  scale: 500
});

var builtUpChangeResampled = builtUpChange.reproject({
  crs: projection,
  scale: 500
});

// ==========================================
// SPATIAL RESOLUTION ANALYSIS
// ==========================================

// Calculate effective number of independent rainfall pixels
var roiArea = roi.area().divide(1000000); // km²
var chirpsPixelArea = 5.5 * 5.5; // km² per CHIRPS pixel
var effectiveRainPixels = roiArea.divide(chirpsPixelArea);

print('====================================');
print('SPATIAL RESOLUTION ANALYSIS');
print('====================================');
print('Study Area (km²):', roiArea);
print('CHIRPS Native Resolution: ~5.5km');
print('Effective CHIRPS Pixels in ROI:', effectiveRainPixels);
print('MODIS NDVI Resolution: 250m');
print('Interpretation: Rainfall data represents ~' + effectiveRainPixels.getInfo().toFixed(0) + 
      ' independent observations across the city.');
print('WARNING: Low spatial resolution may capture regional gradients rather than intra-urban variation.');
print('');

// ==========================================
// 5. IMPROVED SAMPLING WITH CONSISTENT SCALE
// ==========================================

var rawSamples = ee.FeatureCollection.randomPoints(roi, 500);

// Sample all layers at the SAME scale (500m)
var samples = rawSamples.map(function(f) {
  var r = rainTrendResampled.reduceRegion({
    reducer: ee.Reducer.mean(), 
    geometry: f.geometry(), 
    scale: 500,
    bestEffort: true
  }).get('scale');
  
  var n = ndviTrendResampled.reduceRegion({
    reducer: ee.Reducer.mean(), 
    geometry: f.geometry(), 
    scale: 500,
    bestEffort: true
  }).get('scale');
  
  var p = popResampled.reduceRegion({
    reducer: ee.Reducer.mean(), 
    geometry: f.geometry(), 
    scale: 500,
    bestEffort: true
  }).get('population_count');
  
  //Add built-up change as alternative absorption proxy
  var b = builtUpChangeResampled.reduceRegion({
    reducer: ee.Reducer.mean(),
    geometry: f.geometry(),
    scale: 500,
    bestEffort: true
  }).get('built_surface');
  
  return f.set({
    'Rain_Trend': r, 
    'NDVI_Trend': n, 
    'Pop': p,
    'BuiltUp_Change': b
  });
});

// Remove nulls
var validSamples = samples.filter(ee.Filter.notNull(['Rain_Trend', 'NDVI_Trend', 'Pop', 'BuiltUp_Change']));

print('====================================');
print('SAMPLING DIAGNOSTICS');
print('====================================');
print('Total Points Generated:', rawSamples.size());
print('Valid Points after Sampling:', validSamples.size());
print('First Sample Point (Debug):', samples.first());

// ==========================================
// 6. NORMALIZATION FOR RISK SCORING
// ==========================================

// Get min/max for normalization
var rainStats = validSamples.aggregate_stats('Rain_Trend');
var ndviStats = validSamples.aggregate_stats('NDVI_Trend');
var popStats = validSamples.aggregate_stats('Pop');
var builtUpStats = validSamples.aggregate_stats('BuiltUp_Change');

print('====================================');
print('DATA DISTRIBUTION STATISTICS');
print('====================================');
print('Rainfall Trend Stats:', rainStats);
print('NDVI Trend Stats (Vegetation Greenness):', ndviStats);
print('Built-Up Change Stats (Imperviousness):', builtUpStats);
print('Population Stats:', popStats);
print('NOTE: Built-up increase = direct loss of absorption capacity');
print('');

// ==========================================
// 7. ENHANCED RISK ANALYSIS
// ==========================================

var exposureRisk = validSamples.map(function(f) {
  var rain = ee.Number(f.get('Rain_Trend'));
  var ndvi = ee.Number(f.get('NDVI_Trend'));
  var pop = ee.Number(f.get('Pop'));
  
  // Normalized hazard (rainfall increase)
  var hazard = rain.max(0);
  
  // Normalized vulnerability (vegetation loss)
  var vulnerability = ndvi.multiply(-1).max(0);
  
  // Only calculate risk if BOTH hazard AND vulnerability exist
  var hasRisk = hazard.gt(0).and(vulnerability.gt(0));
  
  // Risk score - only non-zero when both conditions met
  var score = ee.Algorithms.If(
    hasRisk,
    hazard.multiply(vulnerability).multiply(pop).multiply(10000000), // Increased multiplier for visibility
    0
  );
  
  return f.set('Risk_Score', score);
});

// ==========================================
// 8. QUADRANT ANALYSIS (H1 Testing)
// ==========================================

var quadrantAnalysis = exposureRisk.map(function(f) {
  var rain = ee.Number(f.get('Rain_Trend'));
  var ndvi = ee.Number(f.get('NDVI_Trend'));
  
  var quadrant = ee.Algorithms.If(
    rain.gt(0),
    ee.Algorithms.If(ndvi.lt(0), 'High_Risk_Aligned', 'Rain_Increase_Only'),
    ee.Algorithms.If(ndvi.lt(0), 'Veg_Loss_Only', 'Low_Change')
  );
  
  return f.set('Quadrant', quadrant);
});

var quadrantCounts = quadrantAnalysis.aggregate_histogram('Quadrant');

// Calculate percentages
var totalPoints = exposureRisk.size();
var alignedPoints = quadrantAnalysis.filter(ee.Filter.eq('Quadrant', 'High_Risk_Aligned'));
var percentAligned = ee.Number(alignedPoints.size()).divide(totalPoints).multiply(100);

// ==========================================
// 9. CORRELATION ANALYSIS
// ==========================================

// Standard Pearson correlation (NDVI-based)
var correlation = exposureRisk.reduceColumns({
  reducer: ee.Reducer.pearsonsCorrelation(),
  selectors: ['NDVI_Trend', 'Rain_Trend']
}).get('correlation');

// Alternative correlation using Built-Up Change
var correlationBuiltUp = exposureRisk.reduceColumns({
  reducer: ee.Reducer.pearsonsCorrelation(),
  selectors: ['BuiltUp_Change', 'Rain_Trend']
}).get('correlation');

// Population-weighted correlation
// First filter points with population > 0 to avoid division issues
var populatedPoints = exposureRisk.filter(ee.Filter.gt('Pop', 0));

// Calculate population-weighted means
var weightedRainMean = populatedPoints.reduceColumns({
  reducer: ee.Reducer.mean(),
  selectors: ['Rain_Trend'],
  weightSelectors: ['Pop']
}).get('mean');

var weightedNdviMean = populatedPoints.reduceColumns({
  reducer: ee.Reducer.mean(),
  selectors: ['NDVI_Trend'],
  weightSelectors: ['Pop']
}).get('mean');

var popWeightedStats = ee.Dictionary({
  'weighted_rain_mean': weightedRainMean,
  'weighted_ndvi_mean': weightedNdviMean
});

// ==========================================
// 10. POPULATION EXPOSURE METRICS (H2)
// ==========================================

// Total population in high-risk areas
var highRiskPop = alignedPoints.aggregate_sum('Pop');
var totalPop = exposureRisk.aggregate_sum('Pop');
var percentPopExposed = ee.Number(highRiskPop).divide(totalPop).multiply(100);

// Cumulative risk score
var cumulativeRisk = exposureRisk.aggregate_sum('Risk_Score');

// Average risk per capita in high-risk zones
var avgRiskHighZones = alignedPoints.aggregate_mean('Risk_Score');

// ==========================================
// 11. COMPREHENSIVE RESULTS OUTPUT
// ==========================================

print('====================================');
print('FINAL RESULTS: ' + cityName);
print('====================================');
print('');
print('--- H1: SPATIAL MISALIGNMENT ANALYSIS ---');
print('Pearson Correlation - NDVI (r):', correlation);
print('Pearson Correlation - Built-Up (r):', correlationBuiltUp);
print('Interpretation: r < 0.3 = Strong misalignment, r > 0.6 = Strong alignment');
print('Quadrant Distribution:', quadrantCounts);
print('% Points in High-Risk Aligned Zone:', percentAligned);
print('NOTE: Built-up correlation shows imperviousness vs rainfall alignment');
print('');
print('--- H2: POPULATION EXPOSURE ANALYSIS ---');
print('Total Population in Study Area:', totalPop);
print('Population in High-Risk Zones:', highRiskPop);
print('% Population Exposed to Aligned Risk:', percentPopExposed);
print('Cumulative Risk Score (City-wide):', cumulativeRisk);
print('Average Risk Score in High-Risk Zones:', avgRiskHighZones);
print('');
print('--- ADDITIONAL METRICS ---');
print('Population-Weighted Regression:', popWeightedStats);
print('Total Area (km²):', roi.area().divide(1000000));

// ==========================================
// 12. VISUALIZATION
// ==========================================

// Trend layers
Map.addLayer(rainTrendResampled.clip(roi), 
  {min: -0.1, max: 0.1, palette: ['blue', 'white', 'red']}, 
  'Rainfall Trend (mm/year)');

Map.addLayer(ndviTrendResampled.clip(roi), 
  {min: -0.001, max: 0.001, palette: ['brown', 'white', 'green']}, 
  'NDVI Trend (per year)');

Map.addLayer(popResampled.clip(roi), 
  {min: 0, max: 1000, palette: ['white', 'yellow', 'orange', 'red']}, 
  'Population Density');

Map.addLayer(builtUpChangeResampled.clip(roi),
  {min: 0, max: 5, palette: ['white', 'gray', 'black']},
  'Built-Up Change (2000-2020)');

// Scatter plot with quadrants
var chart = ui.Chart.feature.byFeature(quadrantAnalysis, 'NDVI_Trend', 'Rain_Trend')
  .setSeriesNames(['Data Points'])
  .setChartType('ScatterChart')
  .setOptions({
    title: cityName + ': Spatial Misalignment Analysis',
    hAxis: {
      title: 'Vegetation Trend (Loss < 0 > Gain)',
      viewWindow: {min: -0.002, max: 0.002}
    },
    vAxis: {
      title: 'Extreme Rainfall Trend (Decrease < 0 > Increase)',
      viewWindow: {min: -0.2, max: 0.4}
    },
    pointSize: 3,
    series: {0: {color: 'red'}},
    trendlines: {0: {color: 'blue', lineWidth: 2, opacity: 0.5}}
  });

print('');
print('--- VISUALIZATION ---');
print(chart);

// Risk distribution histogram - Filter out zeros for better visualization
var nonZeroRisk = exposureRisk.filter(ee.Filter.gt('Risk_Score', 0));

var riskChart = ui.Chart.feature.histogram(nonZeroRisk, 'Risk_Score', 30)
  .setOptions({
    title: cityName + ': Distribution of Risk Scores (Non-Zero Only)',
    hAxis: {title: 'Risk Score'},
    vAxis: {title: 'Frequency'},
    colors: ['#d62728']
  });

print(riskChart);

// Also print count of zero vs non-zero
print('Points with Zero Risk:', exposureRisk.filter(ee.Filter.eq('Risk_Score', 0)).size());
print('Points with Non-Zero Risk:', nonZeroRisk.size());

// ==========================================
// 13. EXPORT READY SUMMARY
// ==========================================

print('====================================');
print('COPY THIS FOR YOUR CROSS-CITY TABLE:');
print('====================================');
print('City: ' + cityName);
print('Correlation (r): ' + correlation.getInfo());
print('% Aligned Risk (Area): ' + percentAligned.getInfo().toFixed(2) + '%');
print('Cumulative Risk Score: ' + cumulativeRisk.getInfo().toFixed(0));
print('Rain Trend SD: ' + rainStats.get('sample_sd').getInfo().toFixed(4));
print('% Population Exposed: ' + percentPopExposed.getInfo().toFixed(2) + '%');
print('Avg Risk in High-Risk Zones: ' + avgRiskHighZones.getInfo().toFixed(0));
print('====================================');
