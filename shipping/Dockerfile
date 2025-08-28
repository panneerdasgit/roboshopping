FROM maven:3.9-eclipse-temurin-21 AS Build

WORKDIR /app

COPY pom.xml /app

COPY src /app/src

RUN mvn package

#runtime stage----

FROM eclipse-temurin:21-jre

WORKDIR /app

ENV CART_ENDPOINT=cart:8080
ENV DB_HOST=mysql


EXPOSE 8080

COPY --from=Build /app/target/*.jar /app/shipping.jar

CMD ["java","-jar","shipping.jar"]


