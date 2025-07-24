# Use an official Node runtime as a parent image
FROM node:18-alpine

# Set the working directory in the container
WORKDIR /app

# Copy the application code into the container
COPY . .

# Expose the port the app runs on
EXPOSE 1122

# Optionally configure admin credentials via environment variables. Defaults are
# provided in server.js. These can be overridden when running the container.
ENV PORT=1122

# Start the application using Node directly. No external dependencies are required.
CMD ["node", "server.js"]