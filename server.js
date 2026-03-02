// ScholarAI - Local Entry Point
const app = require('./api/index');
const port = process.env.PORT || 4000;

app.listen(port, () => {
    console.log(`\n+========================================+`);
    console.log(`|  ScholarAI Backend Server Running      |`);
    console.log(`|  http://localhost:${port}                 |`);
    console.log(`+========================================+\n`);
});
