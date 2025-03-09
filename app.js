const express = require('express');
const axios = require('axios');
const NodeCache = require('node-cache');
const moment = require('moment');
const axiosRetry = require('axios-retry').default;
const cors = require('cors');  // Import cors

// Initialize Express app and caching system
const app = express();
const cache = new NodeCache({ stdTTL: 3600 }); // Cache expiration set to 1 hour (3600 seconds)
const API_URL = 'https://historical-forecast-api.open-meteo.com/v1/forecast';

// Set up retry for Axios requests
axiosRetry(axios, { retries: 5, retryDelay: axiosRetry.exponentialDelay });

// UK Water Cost (per 1,000 litres)
const WATER_COST_PER_1000_LITRES = 1.50;

// Use CORS middleware (to allow all origins)
app.use(cors());  // This will allow all incoming requests from any origin

// Function to fetch weather data from Open-Meteo API
const getWeatherData = async (latitude, longitude, startDate, endDate) => {
    const cacheKey = `${latitude},${longitude},${startDate},${endDate}`;
    
    // Check if data is cached
    const cachedData = cache.get(cacheKey);
    if (cachedData) {
        console.log('Returning cached data');
        return cachedData;
    }

    const params = {
        latitude,
        longitude,
        start_date: startDate,
        end_date: endDate,
        hourly: 'precipitation', // Get hourly precipitation data
    };

    try {
        // Make the API request
        const response = await axios.get(API_URL, { params });
        
        // Cache the response for future use
        cache.set(cacheKey, response.data);
        
        return response.data;
    } catch (error) {
        console.error('Error fetching weather data:', error);
        throw error;
    }
};

// Endpoint to get collected water per month, total water saved, and money saved
app.get('/water-savings', async (req, res) => {
    // Get parameters from query string
    const { latitude, longitude, startDate, endDate, areaSqFt } = req.query;

    // Validate required parameters
    if (!latitude || !longitude || !startDate || !endDate || !areaSqFt) {
        return res.status(400).json({ error: 'Missing required parameters (latitude, longitude, startDate, endDate, areaSqFt)' });
    }

    const area = parseFloat(areaSqFt);
    if (isNaN(area) || area <= 0) {
        return res.status(400).json({ error: 'Invalid area value' });
    }

    try {
        // Fetch weather data from Open-Meteo API
        const weatherData = await getWeatherData(latitude, longitude, startDate, endDate);

        // Check if the hourly data exists
        if (!weatherData.hourly || !weatherData.hourly.time || !weatherData.hourly.precipitation) {
            return res.status(500).json({ error: 'Invalid weather data structure' });
        }

        // Process the data to get collected water (litres) per month
        const dates = weatherData.hourly.time;
        const precipitation = weatherData.hourly.precipitation;

        const monthlyWaterCollected = {};
        let totalWaterCollected = 0;

        dates.forEach((date, index) => {
            const month = moment(date).format('YYYY-MM');  // Get month in YYYY-MM format
            const rainfallMm = precipitation[index];

            if (!monthlyWaterCollected[month]) {
                monthlyWaterCollected[month] = 0;
            }

            // Convert mm of rain into litres collected
            const waterCollected = area * rainfallMm * 0.0929; // Water Collected (litres) = Area (sq. ft.) × Rainfall (mm) × 0.0929 (1 sq. ft. = 0.0929 m²)
            monthlyWaterCollected[month] += waterCollected; // Litres
            totalWaterCollected += waterCollected;
        });

        // Calculate money saved in pounds
        const moneySaved = (totalWaterCollected / 1000) * WATER_COST_PER_1000_LITRES;

        // Send the processed water collection data as the response
        res.json({
            monthlyWaterCollected,
            totalWaterCollected: totalWaterCollected.toFixed(2), // Litres
            moneySaved: moneySaved.toFixed(2), // Pounds (£)
            waterCostPer1000LitrePounds: WATER_COST_PER_1000_LITRES,
            waterCollectedFormula: 'Water Collected (litres) = Area (sq. ft.) × Rainfall (mm) × 0.0929 (1 sq. ft. = 0.0929 m²)'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Start the server
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
