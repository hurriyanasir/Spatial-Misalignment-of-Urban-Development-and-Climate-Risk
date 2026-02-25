// ==========================================
// 1. SETUP & CONFIGURATION
// ==========================================

// SELECT YOUR CITY (Uncomment ONE)
var cityPoint = ee.Geometry.Point([73.0479, 33.6844]);   // Islamabad
// var cityPoint = ee.Geometry.Point([79.8612, 6.9271]);    // Colombo
// var cityPoint = ee.Geometry.Point([72.8777, 19.0760]);   // Mumbai
// var cityPoint = ee.Geometry.Point([101.6869, 3.1319]);      // Kuala Lumpur
// var cityPoint = ee.Geometry.Point([120.1551, 30.2741]);  // Hangzhou
// var cityPoint = ee.Geometry.Point([106.8456, -6.2088]);  // Jakarta
// var cityPoint = ee.Geometry.Point([78.4867, 17.3850]);   // Hyderabad

var cityName = 'Islamabad';

var roi = cityPoint.buffer(20000);
Map.centerObject(roi, 11);
Map.addLayer(roi, {color: 'red'}, 'ROI Boundary');

// ==========================================
// 2. DATA LOADING
// ==========================================

var chirps = ee.ImageCollection("UCSB-CHG/CHIRPS/DAILY");
var modis = ee.ImageCollection("MODIS/061/MOD13Q1");
var popImage = ee.Image("JRC/GHSL/P2023A/GHS_POP/2020")
  .select('population_count');

var builtUp2000 = ee.Image("JRC/GHSL/P2023A/GHS_BUILT_S/2000")
  .select('built_surface');
var builtUp2020 = ee.Image("JRC/GHSL/P2023A/GHS_BUILT_S/2020")
  .select('built_surface');

var builtUpChange = builtUp2020.subtract(builtUp2000).divide(20);

// ==========================================
// 3. TREND CALCULATIONS (2000–2020)
// ==========================================

var years = ee.List.sequence(2000, 2020);

// Rainfall trend (95th percentile extreme rain)
var rainColl = ee.ImageCollection(years.map(function(y) {
  var annual = chirps
    .filter(ee.Filter.calendarRange(y, y, 'year'))
    .reduce(ee.Reducer.percentile([95]))
    .rename('rain');

  var time = ee.Image.constant(y).toFloat().rename('t');
  return ee.Image.cat([time, annual]).set('year', y);
}));

var rainTrend = rainColl
  .reduce(ee.Reducer.linearFit())
  .select('scale');

// NDVI trend (quality filtered + scaled)
var ndviColl = modis
  .filterDate('2000-01-01', '2020-12-31')
  .filterBounds(roi)
  .map(function(img) {

    var qa = img.select('SummaryQA');
    var good = qa.eq(0);

    var ndvi = img.select('NDVI')
      .multiply(0.0001)
      .updateMask(good);

    var date = img.date();
    var year = date.get('year');
    var frac = date.getFraction('year');

    var time = ee.Image(year).add(frac).toFloat().rename('t');

    return ee.Image.cat([time, ndvi]);
  });

var ndviTrend = ndviColl
  .reduce(ee.Reducer.linearFit())
  .select('scale');

// ==========================================
// 4. RESAMPLE TO COMMON 500m GRID
// ==========================================

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
// 5. SPATIAL SMOOTHING (3x3 NEIGHBORHOOD)
// ==========================================

var kernel = ee.Kernel.square({
  radius: 1,
  units: 'pixels',
  normalize: true
});

rainTrendResampled = rainTrendResampled.convolve(kernel);
ndviTrendResampled = ndviTrendResampled.convolve(kernel);
builtUpChangeResampled = builtUpChangeResampled.convolve(kernel);

print('Spatial smoothing applied (3x3 neighborhood mean)');

// ==========================================
// 6. SPATIAL RESOLUTION ANALYSIS
// ==========================================

var roiArea = roi.area().divide(1000000);
var chirpsPixelArea = 5.5 * 5.5;
var effectiveRainPixels = roiArea.divide(chirpsPixelArea);

print('Study Area (km²):', roiArea);
print('Effective CHIRPS Pixels:', effectiveRainPixels);

// ==========================================
// 7. SAMPLING (FIXED SEED)
// ==========================================

var rawSamples = ee.FeatureCollection.randomPoints({
  region: roi,
  points: 500,
  seed: 42
});

var samples = rawSamples.map(function(f) {

  var r = rainTrendResampled.reduceRegion({
    reducer: ee.Reducer.mean(),
    geometry: f.geometry(),
    scale: 500
  }).get('scale');

  var n = ndviTrendResampled.reduceRegion({
    reducer: ee.Reducer.mean(),
    geometry: f.geometry(),
    scale: 500
  }).get('scale');

  var p = popResampled.reduceRegion({
    reducer: ee.Reducer.mean(),
    geometry: f.geometry(),
    scale: 500
  }).get('population_count');

  var b = builtUpChangeResampled.reduceRegion({
    reducer: ee.Reducer.mean(),
    geometry: f.geometry(),
    scale: 500
  }).get('built_surface');

  return f.set({
    Rain_Trend: r,
    NDVI_Trend: n,
    Pop: p,
    BuiltUp_Change: b
  });
});

var validSamples = samples.filter(
  ee.Filter.notNull(['Rain_Trend','NDVI_Trend','Pop','BuiltUp_Change'])
);

print('Valid Points:', validSamples.size());

// ==========================================
// 8. RISK CALCULATION
// ==========================================

var exposureRisk = validSamples.map(function(f) {

  var rain = ee.Number(f.get('Rain_Trend'));
  var ndvi = ee.Number(f.get('NDVI_Trend'));
  var pop = ee.Number(f.get('Pop'));

  var hazard = rain.max(0);
  var vulnerability = ndvi.multiply(-1).max(0);

  var risk = hazard.multiply(vulnerability).multiply(pop);

  return f.set('Risk_Score', risk);
});

// ==========================================
// 9. CORRELATION
// ==========================================

var correlation = exposureRisk.reduceColumns({
  reducer: ee.Reducer.pearsonsCorrelation(),
  selectors: ['NDVI_Trend','Rain_Trend']
}).get('correlation');

var correlationBuiltUp = exposureRisk.reduceColumns({
  reducer: ee.Reducer.pearsonsCorrelation(),
  selectors: ['BuiltUp_Change','Rain_Trend']
}).get('correlation');

// ==========================================
// 10. EXPOSURE METRICS
// ==========================================

var aligned = exposureRisk.filter(
  ee.Filter.and(
    ee.Filter.gt('Rain_Trend',0),
    ee.Filter.lt('NDVI_Trend',0)
  )
);

var percentAligned = ee.Number(aligned.size())
  .divide(exposureRisk.size())
  .multiply(100);

var highRiskPop = aligned.aggregate_sum('Pop');
var totalPop = exposureRisk.aggregate_sum('Pop');
var percentPopExposed = ee.Number(highRiskPop)
  .divide(totalPop)
  .multiply(100);

var cumulativeRisk = exposureRisk.aggregate_sum('Risk_Score');

// ==========================================
// 11. RESULTS
// ==========================================

print('--- FINAL RESULTS: ' + cityName + ' ---');
print('Correlation (NDVI vs Rain):', correlation);
print('Correlation (BuiltUp vs Rain):', correlationBuiltUp);
print('% Area High-Risk:', percentAligned);
print('% Population Exposed:', percentPopExposed);
print('Cumulative Risk:', cumulativeRisk);

// ==========================================
// 12. VISUALIZATION
// ==========================================

Map.addLayer(
  rainTrendResampled.clip(roi),
  {min:-0.1, max:0.1, palette:['blue','white','red']},
  'Rainfall Trend (Smoothed)'
);

Map.addLayer(
  ndviTrendResampled.clip(roi),
  {min:-0.001, max:0.001, palette:['brown','white','green']},
  'NDVI Trend (Smoothed)'
);

Map.addLayer(
  builtUpChangeResampled.clip(roi),
  {min:0, max:5, palette:['white','gray','black']},
  'Built-Up Change (Smoothed)'
);
