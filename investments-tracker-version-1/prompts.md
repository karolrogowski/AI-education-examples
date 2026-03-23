# CLAUDE.md

```
Start with initialising CLAUDE.md file. 

# General purpose
I want to build an application in this repository that would be able to read a CSV file containing a list of all the investments I've made and prepare a series of diagrams enabling me to better understand my investments and track my invested money. 

# Constraints
- I want this application to be simple.
- I don't want to store the data in any database - I want to give the user two ways to upload the data:
    * after starting the application just upload the CSV file
    * or the application can search for a CSV file on my local machine upon startup
- I don't want this application to have a complicated backend layer - maybe the backend layer won't be needed at all.
- I want this application to be able to track the current price of the instruments I've bought - but don't use any paid tool for that
- It needs to show me the chart of a concrete instrument I own with marked timestamps when I bought this particular instrument units
- I want this application to show the me overall gain or loss on my investments categorised by the instrument I've bought
- I want this application to be able to draw a series of diagrams:    
    * a pie chart showing the ratio of my investments: stocks, bonds, crypto, cash, precious metals etc. This chart would be showing this ratio as of now
    * a chart showing the ratio of my investments (like the point above) but in time
    * a chart showing a gain or loss over time and compare to the amount of money I've invested over time
    * a chart showing dividends paid over time
```

# Agent
```
You're a frontend developer specialist experienced with stock market. You have expertiese in individual investors portfolio tracking applications and basing on your experience you're able to suggest best ways to track gains or losses and overall portfolio performance. 

You don't overcomplicate, you keep things simple. 
Before taking any action, you ask user for confirmation.
You show step by step reasoning when discussing features.
You speak plainly. You avoid jargon unless the user clearly understands it, and you always define financial terms when introducing them. 
```

# Actual work

```
Let's start with building the application. First I need a scafolldings, a simple app that would be able to drag-drop an example CSV file and display it's content. It's likely to be changed later. Prepare an example   
  CSV file containing 15 positions to well cover different edge cases. Explain step by step how I can run the application.
```

```
Add the next feature. If there is a portfolio.csv file defined in the example-data directory, load it on startup. When I drag-drop another file, replace what's displayed with the uploaded file.
```

```
This example CSV file contains dividends. In the application we're writing, I want the dividends to be automatically calculated basin on external resources and my portfolio content. I don't want to put dividends manually in the CSV file.
```

# Adding columns broker and comment

```
Great, next I want to replace the current list dispplaying the CSV content as it is to an aggregated view. The data is aggregated by Broker so that I can see the current amounts of assets I own. It means that under each broker I'll see the instrument I have in that broker and I'll see the current number of units per instrument I own. I want this to be displayed in a table with the following columns:
    * Asset Name (ticker)
    * Number of units
    * Min price I've ever bought this instrument for
    * Max price I've ever bought this instrument for
    * For how many days I actually have this instrument
    * How much money I've put into this instrument in total
    * What's the percentage ratio in my all assets
    * Rate of return
    * Total Gain or Loss - if gain make it green, if loss make it red
    * History - since the original view is grouped, I want to have a link there that would open a modal showing a full history of this particular asset. Within this modal, I want to see the rows of transactions with wrong price (comparing the market price at that time)
```

```
Problems I see for now:
- VOO row, TOTAL INVESTED shows 4636,78 USD, but there are two rows aggregated there with two amounts 390,14 USD + 505,22 USD != 4636,78 USD 
- Portfolio %, RETURN % and GAIN/LOSS all show -, which means there is a problem with the API connectivity
```

```
Previously I asked for this: "I want to see the rows of transactions with wrong price (comparing the market price at that time)". Which row can present this behaviour?

I want this functionality to be able to determine, if I didn't make a mistake putting the data in the CSV file. I'm a passive investor, not an active one. IS really the best option? 
```

```
Next, I want to be able to collapse each broker so that I can see the data selectively. 

I also want to add dark/light mode switch to the webpage. 
```

```
Next, I want to see a summary of all my assets above the exising brokers summary. I want to see:
- all my assets current value (including the assets value market changes)
- all my assets input value (how much money I've originally spent on them)
- daily percentage change
- daily value change
- all return rate
- average yearly return rate

For all the above, if gain - green, if loss - red.
```

```
I want to add the following information to the collapsable label for each of the brokers:
- current value
- input value
- all return rate
- portfolio %
```

```
In the header, I want to add a currency that would be used to present the data in the webpage. It doesn't change the currency in the CSV file, it's only used to present the data. Create a dropdown with the values: EUR, USD, PLN
```

```
Is it possible to write tests so that we're sure that the values displayed are correct? As I verfied, it's displayed correctly but I want to be sure that all the calculations are correct.
```

```
Now, below the aggregated data per broker broker, draw the following charts:
    * a pie chart showing the ratio of my investments: stocks, bonds, crypto, cash, precious metals etc. This chart would be showing this ratio as of now
    * a chart showing the ratio of my investments (like the point above) but in time
    * a chart showing a gain or loss over time and compare to the amount of money I've invested over time
    * a chart showing dividends paid over time
```

```
Next set of things I don't quite understand or I think should be taken look at and fixed:
- TLT, return % shows minus, but the amount gain/loss shows positive value - I don't know if it's gain or loss - change the return % and gain/loss to be green if gain, red if loss
- Coinbase, label value, invested is 33029,04, value is 37032,51, and gain is 100%, I don't get how it's calculated
- under each table, I'm missing 'current value' next to total invested, so that I could compare these 2
- when hovering over days held, I'd like to see number of years and days, like "3 years, 5 months, 2 days"
```

```
- I want to add a progress bar of some kind, after refreshing the page, when API data is not loaded yet. Set timeout to 15 secods, if it's not loaded, show alert saying that data is not loaded.
- make PLN the default currency after reloading the page
- AAPL, total invested is 8065,93 zł, current value 6427,45 zł, and gain shows +3633,14 zł. How current value is lower, if there is a positive gain 
- you forgot about displaying the text in green if there is gain and red if there is loss
```

```
Change the order of the following information:
- broker collapsable panel header - currently: value, cost basis, return, portfolio - change to: cost basis (rename to invested), value (rename to current value), return, portfolio
- asset, units, min buy, max buy, days held, cost basis, current value, portfolio %, return %, gain/loss, history - change order to: asset, units, min buy, max buy, days held, cost basis (rename to invested), current value, return %, gain/loss, portfolio %, history


Then in the "history" modal, change qty to units
```

```
Another set of things to be fixed:
- gain/loss vs invested chart, when changing the currancy to PLN it still shows $
- dividends received chart, when changing the currancy to PLN it still shows $
- dividends received chart, when hovering over a certain year, I want to see a list of dividends per asset that paid this dividend and which month exactly
```

```
I want to focus on the charts:
- current allocation vs allocation over time - the right edge values, the last values for allocation over time differ from current allocation
- gain/loss vs invested - it's missing data for the portfolio value for march 26 
```

```
After replacing the portfolio.csv file, I can't see the current values for the following tickers:
- VWRL
- VHYL
- EMIM
```

```
I want to make the following changes to the diagrams:
- I want the diagrams be all below each other, not next to each other
- Current allocation differs again from the allocation over time, when I look at allocation over time, the current values differ from current allocation
- in the current allocation, I also want to show the percentages without hovering on the pie parts
- gain/loss vs intested shows different values from the top of the page total invested and total current value
- dividends chart is missing dividends 
```