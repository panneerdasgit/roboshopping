#
# Build Stage
#
FROM maven:3.9.8-eclipse-temurin-11 AS build
# You can switch to "maven:3.9.8-eclipse-temurin-8" if project needs Java 8

WORKDIR /opt/shipping

# Copy pom.xml and resolve dependencies first (layer caching)
COPY pom.xml .
RUN mvn dependency:go-offline -B

# Copy source code and build
COPY src ./src
RUN mvn clean package -DskipTests

#
# Runtime Stage
#
FROM eclipse-temurin:11-jre
# Or use eclipse-temurin:8-jre if you must stick with Java 8

EXPOSE 8080
WORKDIR /opt/shipping

# Environment variables
ENV CART_ENDPOINT=cart:8080
ENV DB_HOST=mysql

# Copy the built jar from build stage
COPY --from=build /opt/shipping/target/shipping-1.0.jar shipping.jar

# Run the service
CMD ["java", "-Xmn256m", "-Xmx768m", "-jar", "shipping.jar"]
